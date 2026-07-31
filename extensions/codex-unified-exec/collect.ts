/**
 * Collect buffered output until a deadline, mirroring codex's
 * collect_output_until_deadline (process_manager.rs).
 *
 * Differences from codex, all deliberate and host-repo-specific:
 *   - No `pause_state`: pi-processes has no elicitation-pause mechanism, so the
 *     extend-deadlines-while-paused branch is omitted. Pause semantics would
 *     otherwise lengthen the deadline by the paused duration.
 *   - No `Mutex<HeadTailBuffer>`: JS is single-threaded, so the buffer is
 *     drained directly instead of locked.
 *
 * Otherwise the loop, the empty/non-empty handling, the post-exit close-wait
 * cap (POST_EXIT_CLOSE_WAIT_MS = 50 ms), and the deadline/cancellation checks
 * match codex line for line.
 */

import { POST_EXIT_CLOSE_WAIT_MS } from "./constants";
import { HeadTailBuffer } from "./head-tail-buffer";
import {
  type CancellationToken,
  type Gate,
  type Notify,
  sleep,
} from "./notify";

export interface CollectOptions {
  /** Live per-session buffer; drained each iteration, refilled by the producer. */
  buffer: HeadTailBuffer;
  /** Signaled whenever new output is appended to the buffer. */
  outputNotify: Notify;
  /** Closed once the process output streams are fully closed. */
  outputClosed: Gate;
  /** Process lifecycle cancellation (exit / shutdown). */
  cancellationToken: CancellationToken;
  /** Absolute deadline in epoch ms (Date.now()). */
  deadline: number;
}

export async function collectOutputUntilDeadline(
  opts: CollectOptions,
): Promise<HeadTailBuffer> {
  const { buffer, outputNotify, outputClosed, cancellationToken, deadline } =
    opts;

  const collected = new HeadTailBuffer(buffer.maxBytes);
  let exitSignalReceived = cancellationToken.isCancelled;
  let postExitDeadline: number | null = null;

  for (;;) {
    const drained = buffer.drain();
    const hasDrained = drained.retainedBytes > 0 || drained.omittedBytes > 0;

    if (!hasDrained) {
      exitSignalReceived = exitSignalReceived || cancellationToken.isCancelled;
      if (exitSignalReceived && outputClosed.isClosed) break;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      if (exitSignalReceived) {
        const now = Date.now();
        const closeWaitDeadline: number =
          postExitDeadline ??
          now + Math.min(remaining, POST_EXIT_CLOSE_WAIT_MS);
        postExitDeadline = closeWaitDeadline;
        const closeWaitRemaining = closeWaitDeadline - now;
        if (closeWaitRemaining <= 0) break;
        await Promise.race([
          outputNotify.notified(),
          outputClosed.closed(),
          cancellationToken.cancelled(),
          sleep(closeWaitRemaining),
        ]);
        continue;
      }

      await Promise.race([
        outputNotify.notified(),
        cancellationToken.cancelled(),
        sleep(remaining),
      ]);
      continue;
    }

    collected.pushBuffer(drained);
    exitSignalReceived = exitSignalReceived || cancellationToken.isCancelled;
    if (Date.now() >= deadline) break;
  }

  return collected;
}
