/**
 * Async primitives adapted from the tokio/tokio-util types that codex's
 * collect_output_until_deadline depends on: `Notify`, `AtomicBool` + a second
 * `Notify`, and `CancellationToken`.
 *
 * These are the only concurrency primitives the unified-exec collect loop
 * needs; they are intentionally minimal and single-threaded (JS).
 */

/** One-shot-per-wait async gate (Tokio Notify semantics). */
export class Notify {
  private waiters: Array<() => void> = [];

  /**
   * Resolve on the next notifyAll. Notifications issued before parking are
   * lost (no backlog). All parked waiters wake on a single notifyAll.
   */
  notified(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  notifyAll(): void {
    if (this.waiters.length === 0) return;
    const toWake = this.waiters;
    this.waiters = [];
    for (const resolve of toWake) resolve();
  }
}

/**
 * Sticky boolean gate. Collapses codex's `output_closed: AtomicBool` plus its
 * `output_closed_notify`. Once closed, closed() resolves immediately forever.
 */
export class Gate {
  private closedFlag = false;
  private waiters: Array<() => void> = [];

  get isClosed(): boolean {
    return this.closedFlag;
  }

  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    const toWake = this.waiters;
    this.waiters = [];
    for (const resolve of toWake) resolve();
  }

  closed(): Promise<void> {
    if (this.closedFlag) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/**
 * Cooperative cancellation (tokio_util::CancellationToken semantics).
 * Used by the collect loop as the deadline-bounded process-exit signal.
 */
export class CancellationToken {
  private cancelledFlag = false;
  private waiters: Array<() => void> = [];

  get isCancelled(): boolean {
    return this.cancelledFlag;
  }

  cancel(): void {
    if (this.cancelledFlag) return;
    this.cancelledFlag = true;
    const toWake = this.waiters;
    this.waiters = [];
    for (const resolve of toWake) resolve();
  }

  /** Resolve immediately if already cancelled, otherwise on the next cancel(). */
  cancelled(): Promise<void> {
    if (this.cancelledFlag) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/** Sleep for `ms`, resolving early if the optional signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
