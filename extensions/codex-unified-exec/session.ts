/**
 * Codex unified-exec session model over a pi-processes ProcessManager.
 *
 * Direct port of codex's UnifiedExecProcessManager
 * (codex-rs/core/src/unified_exec/process_manager.rs): numeric codex session
 * ids -> live sessions, raw-byte output buffering via HeadTailBuffer,
 * collectOutputUntilDeadline per call, and LRU eviction at
 * MAX_UNIFIED_EXEC_PROCESSES.
 *
 * Differences from codex, all deliberate and pipe-only:
 *   - No sandbox/approval/network/remote-env machinery (pi has none). exec_command
 *     spawns via the host ProcessManager; write_stdin writes to the pipe stdin.
 *   - No PTY: a non-empty write_stdin writes to the (always-open) pipe stdin
 *     regardless of `tty`. In codex, only tty sessions accept stdin and a non-tty
 *     non-interrupt write errors with StdinClosed; this port keeps pipe stdin
 *     open so interactive pipe sessions work without a PTY.
 *   - `\u0003` (Ctrl-C / ETX) is sent as SIGINT to the process group, mirroring
 *     codex's interrupt() (non-tty) and PTY ^C (tty).
 */

import { isAbsolute, resolve } from "node:path";

import type { ManagerEvent, ProcessInfo, WriteResult } from "../../src/manager";
import { LIVE_STATUSES } from "../../src/types";
import { killProcessGroup } from "../../src/utils";
import { collectOutputUntilDeadline } from "./collect";
import {
  applyCodexExecEnv,
  clampPassiveYield,
  clampYieldTime,
  DEFAULT_MAX_BACKGROUND_POLL_MS,
  generateChunkId,
  MAX_UNIFIED_EXEC_PROCESSES,
  UNIFIED_EXEC_OUTPUT_MAX_BYTES,
} from "./constants";
import { HeadTailBuffer } from "./head-tail-buffer";
import { CancellationToken, Gate, Notify, sleep } from "./notify";
import type { ExecCommandOutput } from "./render";
import { approxTokensFromByteCount } from "./truncation";

/** Codex exec_command serde default (default_exec_yield_time_ms). */
const DEFAULT_EXEC_YIELD_TIME_MS = 10_000;
/** Codex write_stdin serde default (default_write_stdin_yield_time_ms). */
const DEFAULT_WRITE_STDIN_YIELD_TIME_MS = 250;
/** Codex protects the 8 most-recently-used sessions from LRU pruning. */
const PROTECTED_LRU_COUNT = 8;
/** After a successful stdin write, wait briefly so the process can react. */
const POST_WRITE_REACTION_WAIT_MS = 100;
/** Codex Ctrl-C / ETX byte sent by the model to interrupt a session. */
const INTERRUPT = "\u0003";

/** Spawn + collect request for exec_command. */
export interface ExecCommandRequest {
  cmd: string;
  workdir?: string;
  tty?: boolean;
  yield_time_ms?: number;
  max_output_tokens?: number;
  shell?: string;
  /** Agent cwd (ctx.cwd); workdir resolves against this. */
  cwd: string;
}

/** Poll / continue request for write_stdin. */
export interface WriteStdinRequest {
  session_id: number;
  chars?: string;
  yield_time_ms?: number;
  max_output_tokens?: number;
}

export interface SessionManagerOptions {
  maxBytes?: number;
  maxProcesses?: number;
  maxBackgroundPollMs?: number;
}

/**
 * The slice of a pi-processes ProcessManager that SessionManager depends on.
 * Declaring the dependency structurally keeps the session layer testable with a
 * lightweight fake (the real ProcessManager carries private state that would
 * otherwise make it nominally incompatible).
 */
export interface ProcessManagerLike {
  start(
    name: string,
    command: string,
    cwd: string,
    opts?: {
      shellPath?: string;
      env?: NodeJS.ProcessEnv;
    },
  ): ProcessInfo;
  get(id: string): ProcessInfo | null;
  onRawOutput(listener: (id: string, chunk: Buffer) => void): () => void;
  onEvent(listener: (event: ManagerEvent) => void): () => void;
  writeToStdin(id: string, data: string, opts?: { end?: boolean }): WriteResult;
  killAll(): void;
  cleanup(): void;
}

interface Session {
  codexId: number;
  piId: string;
  pid: number;
  buffer: HeadTailBuffer;
  outputNotify: Notify;
  outputClosed: Gate;
  cancellationToken: CancellationToken;
  exitCode: number | null;
  hasExited: boolean;
  lastUsed: number;
  /** Per-session FIFO mutex (codex interaction_lock). */
  interactPromise: Promise<void>;
  /** True while a collect is in flight; pruning skips interacting sessions. */
  interacting: boolean;
}

export class SessionManager {
  private manager: ProcessManagerLike;
  private sessions = new Map<number, Session>();
  private byPiId = new Map<string, Session>();
  private reserved = new Set<number>();
  private unsubscribeRaw: (() => void) | undefined;
  private unsubscribeEvents: (() => void) | undefined;

  private readonly maxBytes: number;
  private readonly maxProcesses: number;
  private readonly maxBackgroundPollMs: number;

  constructor(manager: ProcessManagerLike, opts?: SessionManagerOptions) {
    this.manager = manager;
    this.maxBytes = opts?.maxBytes ?? UNIFIED_EXEC_OUTPUT_MAX_BYTES;
    this.maxProcesses = opts?.maxProcesses ?? MAX_UNIFIED_EXEC_PROCESSES;
    this.maxBackgroundPollMs =
      opts?.maxBackgroundPollMs ?? DEFAULT_MAX_BACKGROUND_POLL_MS;

    this.unsubscribeRaw = manager.onRawOutput((id, chunk) => {
      const session = this.byPiId.get(id);
      if (!session) return;
      session.buffer.pushChunk(chunk);
      session.outputNotify.notifyAll();
    });

    this.unsubscribeEvents = manager.onEvent((event) => {
      if (event.type !== "process_ended") return;
      const session = this.byPiId.get(event.info.id);
      if (!session) return;
      session.exitCode = event.info.exitCode;
      session.hasExited = true;
      session.outputClosed.close();
      session.cancellationToken.cancel();
    });
  }

  /** exec_command: spawn, register, collect, and return the codex output. */
  async execCommand(req: ExecCommandRequest): Promise<ExecCommandOutput> {
    if (!req.cmd || req.cmd.length === 0) {
      throw new Error("exec_command requires a non-empty `cmd`");
    }

    const codexId = this.allocateProcessId();
    const yieldTime = clampYieldTime(
      req.yield_time_ms ?? DEFAULT_EXEC_YIELD_TIME_MS,
    );

    const workdir =
      req.workdir && req.workdir.length > 0 ? req.workdir : undefined;
    const cwd = workdir
      ? isAbsolute(workdir)
        ? workdir
        : resolve(req.cwd, workdir)
      : req.cwd;

    let info: ProcessInfo;
    try {
      info = this.manager.start(`codex-${codexId}`, req.cmd, cwd, {
        env: applyCodexExecEnv(process.env),
        ...(req.shell ? { shellPath: req.shell } : {}),
      });
    } catch (error) {
      this.reserved.delete(codexId);
      throw new Error(
        `exec_command failed for \`${req.cmd}\`: ${(error as Error).message}`,
      );
    }

    const session: Session = {
      codexId,
      piId: info.id,
      pid: info.pid,
      buffer: new HeadTailBuffer(this.maxBytes),
      outputNotify: new Notify(),
      outputClosed: new Gate(),
      cancellationToken: new CancellationToken(),
      exitCode: null,
      hasExited: false,
      lastUsed: Date.now(),
      interactPromise: Promise.resolve(),
      interacting: false,
    };
    this.sessions.set(codexId, session);
    this.byPiId.set(info.id, session);

    // A missing-pid spawn or an ultra-fast command can end during `start`,
    // firing process_ended before this session was registered. Reconcile from
    // the manager's current record so the very first collect short-circuits.
    const current = this.manager.get(info.id);
    if (current && !LIVE_STATUSES.has(current.status)) {
      session.exitCode = current.exitCode;
      session.hasExited = true;
      session.outputClosed.close();
      session.cancellationToken.cancel();
    }

    this.pruneIfNeeded();

    return this.runExclusive(session, () =>
      this.collectAndFormat(session, yieldTime, req.max_output_tokens),
    );
  }

  /** write_stdin: poll or continue an existing session. */
  async writeStdin(req: WriteStdinRequest): Promise<ExecCommandOutput> {
    const session = this.sessions.get(req.session_id);
    if (!session) {
      throw new Error(
        `write_stdin failed: unknown session id ${req.session_id}`,
      );
    }

    const chars = req.chars ?? "";
    const yieldTime = clampPassiveYield(
      chars,
      req.yield_time_ms ?? DEFAULT_WRITE_STDIN_YIELD_TIME_MS,
      this.maxBackgroundPollMs,
    );

    return this.runExclusive(session, async () => {
      if (chars.length > 0) {
        if (chars === INTERRUPT) {
          // SIGINT the whole process group (codex interrupt() for non-tty,
          // and ^C delivered to the PTY for tty). Fire and forget: the exit
          // watcher closes the session via process_ended.
          try {
            killProcessGroup(session.pid, "SIGINT");
          } catch (_error) {
            void _error;
            // The group may already be gone; the collect below reconciles.
          }
        } else {
          const result = this.manager.writeToStdin(session.piId, chars);
          if (!result.ok) {
            // process_exited is recoverable (codex records status_after_write
            // and still collects). Anything else is a hard error.
            if (result.reason !== "process_exited") {
              throw new Error(`write_stdin failed: ${result.reason}`);
            }
          } else {
            await sleep(POST_WRITE_REACTION_WAIT_MS);
          }
        }
      }

      return this.collectAndFormat(session, yieldTime, req.max_output_tokens);
    });
  }

  /** Kill all sessions, unsubscribe, and clean up the underlying manager. */
  dispose(): void {
    this.unsubscribeRaw?.();
    this.unsubscribeEvents?.();
    for (const session of this.sessions.values()) {
      session.cancellationToken.cancel();
      session.outputClosed.close();
    }
    this.manager.killAll();
    this.manager.cleanup();
    this.sessions.clear();
    this.byPiId.clear();
    this.reserved.clear();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // -- internals -----------------------------------------------------------

  /**
   * Collect buffered output until the deadline, then build the codex
   * ExecCommandToolOutput. Releases the session if the process ended during
   * this collect (mirrors codex refresh_process_state + release_process_id).
   */
  private async collectAndFormat(
    session: Session,
    yieldTime: number,
    maxOutputTokens?: number,
  ): Promise<ExecCommandOutput> {
    session.lastUsed = Date.now();
    const start = Date.now();
    const deadline = start + yieldTime;

    const collected = await collectOutputUntilDeadline({
      buffer: session.buffer,
      outputNotify: session.outputNotify,
      outputClosed: session.outputClosed,
      cancellationToken: session.cancellationToken,
      deadline,
    });

    const wallTimeMs = Date.now() - start;
    const originalTokenCount = approxTokensFromByteCount(
      collected.totalBytes(),
    );
    const outputOmittedBytes =
      collected.omittedBytes > 0 ? collected.omittedBytes : null;
    const rawOutput = collected.toBytesWithOmissionMarker();
    const chunkId = generateChunkId();

    const alive = !session.hasExited;
    let processId: number | null;
    let exitCode: number | null;
    if (alive) {
      processId = session.codexId;
      exitCode = null;
    } else {
      processId = null;
      exitCode = session.exitCode ?? -1;
      this.release(session.codexId, false);
    }

    return {
      chunkId,
      wallTimeMs,
      rawOutput,
      maxOutputTokens: maxOutputTokens,
      processId,
      exitCode,
      originalTokenCount,
      outputOmittedBytes,
    };
  }

  /**
   * Serialize interactions on one session (codex interaction_lock) and mark it
   * interacting so pruning never evicts a session mid-poll.
   */
  private runExclusive<T>(session: Session, fn: () => Promise<T>): Promise<T> {
    const tail = session.interactPromise;
    let unlock: () => void = () => {};
    session.interactPromise = new Promise<void>((resolve_) => {
      unlock = resolve_;
    });
    return tail.then(async () => {
      session.interacting = true;
      try {
        return await fn();
      } finally {
        session.interacting = false;
        unlock();
      }
    }) as Promise<T>;
  }

  /** Allocate a random codex session id in [1000, 100000). */
  private allocateProcessId(): number {
    for (;;) {
      const id = Math.floor(Math.random() * (100_000 - 1_000)) + 1_000;
      if (this.reserved.has(id)) continue;
      this.reserved.add(id);
      return id;
    }
  }

  /**
   * Remove a session from the store. `kill` sends SIGKILL to a still-live
   * process group (LRU eviction). A released codex id is freed for reuse.
   */
  private release(codexId: number, kill: boolean): Session | undefined {
    const session = this.sessions.get(codexId);
    this.reserved.delete(codexId);
    if (!session) return undefined;
    this.sessions.delete(codexId);
    this.byPiId.delete(session.piId);
    if (kill && !session.hasExited) {
      try {
        killProcessGroup(session.pid, "SIGKILL");
      } catch (_error) {
        void _error;
        // Already dead; the exit watcher reconciles via process_ended.
      }
    }
    return session;
  }

  /**
   * Evict one session if at capacity, mirroring codex
   * prune_processes_if_needed: protect the 8 most-recently-used, prefer evicting
   * an exited session, else evict the LRU non-protected, never a session that is
   * mid-interaction.
   */
  private pruneIfNeeded(): void {
    if (this.sessions.size < this.maxProcesses) return;

    const entries = [...this.sessions.values()].sort(
      (a, b) => a.lastUsed - b.lastUsed,
    );
    const byRecencyDesc = [...this.sessions.values()].sort(
      (a, b) => b.lastUsed - a.lastUsed,
    );
    const protectedIds = new Set(
      byRecencyDesc
        .slice(0, PROTECTED_LRU_COUNT)
        .map((session) => session.codexId),
    );

    const candidates = entries.filter(
      (session) => !protectedIds.has(session.codexId) && !session.interacting,
    );
    const exited = candidates.find((session) => session.hasExited);
    const victim = exited ?? candidates[0];
    if (!victim) return;

    this.release(victim.codexId, true);
  }
}
