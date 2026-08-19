import type { ChildProcess } from "node:child_process";

import type {
  AdoptProcessOptions,
  KillResult,
  ManagerEvent,
  WriteResult,
} from "../types";
import { LIVE_STATUSES } from "../types";
import { isProcessGroupAlive, killProcessGroup } from "../utils";
import { spawnCommand } from "../utils/command-executor";
import { formatSignalInfo } from "../utils/signals";
import type { ManagedProcessRecord } from "./internal-types";
import { formatProcess } from "./internal-types";
import { FINISHED_RECORD_GRACE_MS, MAX_FINISHED_RECORDS } from "./limits";
import type { ProcessLogStore } from "./process-log-store";
import type { ProcessOutput } from "./process-output";
import type { ProcessRegistry } from "./process-registry";

interface ProcessRuntimeControllerDeps {
  registry: ProcessRegistry;
  logs: ProcessLogStore;
  output: ProcessOutput;
  emit: (event: ManagerEvent) => void;
  getConfiguredShellPath: () => string | undefined;
}

export class ProcessRuntimeController {
  private registry: ProcessRegistry;
  private logs: ProcessLogStore;
  private output: ProcessOutput;
  private emit: (event: ManagerEvent) => void;
  private getConfiguredShellPath: () => string | undefined;

  private watcher: ReturnType<typeof setInterval> | null = null;
  private finishedReapTimer: ReturnType<typeof setTimeout> | null = null;
  private completionSequence = 0;
  private shuttingDown = false;

  constructor(deps: ProcessRuntimeControllerDeps) {
    this.registry = deps.registry;
    this.logs = deps.logs;
    this.output = deps.output;
    this.emit = deps.emit;
    this.getConfiguredShellPath = deps.getConfiguredShellPath;
  }

  start(name: string, command: string, cwd: string): ManagedProcessRecord {
    const child = spawnCommand(command, cwd, this.getConfiguredShellPath());
    return this.register(name, command, cwd, child, {});
  }

  /**
   * Adopt an externally spawned child process into the manager.
   *
   * The child must have been spawned like `spawnCommand` spawns: in a
   * detached process group (`detached: true`) with piped stdio, so group
   * kill and liveness polling behave identically to started processes.
   *
   * `initialOutput` is output the adopter captured before handing the
   * process over; it is appended to the logs ahead of any future stdio.
   * `startTime` backdates the record to when the command actually began.
   */
  adopt(
    name: string,
    command: string,
    cwd: string,
    child: ChildProcess,
    opts?: AdoptProcessOptions,
  ): ManagedProcessRecord {
    return this.register(name, command, cwd, child, {
      initialOutput: opts?.initialOutput,
      startTime: opts?.startTime,
    });
  }

  private register(
    name: string,
    command: string,
    cwd: string,
    child: ChildProcess,
    opts: AdoptProcessOptions,
  ): ManagedProcessRecord {
    const id = this.registry.nextId();
    const logPaths = this.logs.createLogs(id);

    // Spawned commands run in detached process groups so TERM/KILL can target
    // the whole tree. `unref()` keeps the manager's Node process from staying
    // alive only because a managed child still exists; extension shutdown and
    // explicit cleanup remain responsible for killing live process groups.
    child.unref();

    const managed: ManagedProcessRecord = {
      id,
      name,
      pid: child.pid ?? -1,
      command,
      cwd,
      startTime: opts.startTime ?? Date.now(),
      endTime: null,
      status: "running",
      exitCode: null,
      success: null,
      stdoutFile: logPaths.stdoutFile,
      stderrFile: logPaths.stderrFile,
      endReason: null,
      signal: null,
      errorMessage: null,
      combinedFile: logPaths.combinedFile,
      stdin: child.stdin,
      stdinClosed: false,
      lastSignalSent: null,
      completionSequence: null,
      stdoutPendingLine: Buffer.alloc(0),
      stderrPendingLine: Buffer.alloc(0),
      stdoutLineOverflowed: false,
      stderrLineOverflowed: false,
      appendedLines: [],
      droppedLineCount: 0,
    };

    this.registry.add(managed);

    if (!child.pid) {
      // No pid means the process never started. The async spawn `error`
      // event may not have been delivered yet (Node emits it on a later
      // turn of the event loop, and it cannot fire while start() runs),
      // so attach a handler that finalizes the record with the real
      // reason when it arrives.
      this.logs.appendErrorLine(managed.stderrFile, "Spawn error: missing pid");
      managed.exitCode = -1;
      managed.success = false;
      managed.endReason = "missing_pid";
      managed.errorMessage = "Spawn error: missing pid";
      managed.endTime = Date.now();
      this.releaseRuntimeHandles(managed);
      this.transition(managed, "exited");
      child.on("error", (err) => {
        this.logs.appendErrorLine(
          managed.stderrFile,
          `Process error: ${err.message}`,
        );
        managed.endReason = "spawn_error";
        managed.errorMessage = err.message;
      });
      return managed;
    }

    if (opts.initialOutput && opts.initialOutput.length > 0) {
      this.logs.appendStdout(managed.stdoutFile, opts.initialOutput);
      this.output.onStdoutChunk(managed, opts.initialOutput);
    }

    this.wireStdioHandlers(managed, child);

    this.emit({ type: "process_started", info: formatProcess(managed) });
    this.finalizeIfAlreadyClosed(managed, child);
    this.ensureWatcherRunning();

    return managed;
  }

  /**
   * An adopted child may have fully exited (close event fired) before its
   * handlers were attached here. In that case no close event will ever
   * reach wireStdioHandlers, so replay the close classification directly.
   * If the child exited but its streams are still open, the pending close
   * event will finalize the record through the normal path.
   */
  private finalizeIfAlreadyClosed(
    managed: ManagedProcessRecord,
    child: ChildProcess,
  ): void {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (!exited) return;

    const streamsDone =
      (child.stdout?.destroyed ?? true) && (child.stderr?.destroyed ?? true);
    if (!streamsDone) return;

    this.releaseRuntimeHandles(managed);
    if (managed.endTime) return;

    managed.exitCode = child.exitCode;
    managed.endTime = Date.now();
    this.output.flush(managed);

    if (child.signalCode) {
      managed.success = false;
      managed.endReason = "signal";
      managed.signal = formatSignalInfo(child.signalCode);
      this.transition(managed, "killed");
    } else {
      managed.success = child.exitCode === 0;
      managed.endReason = "exit";
      managed.signal = null;
      this.transition(managed, "exited");
    }
  }

  transition(managed: ManagedProcessRecord, next: typeof managed.status): void {
    if (managed.status === next) return;
    managed.status = next;

    if (next === "exited" || next === "killed") {
      managed.completionSequence ??= ++this.completionSequence;
      this.emit({ type: "process_ended", info: formatProcess(managed) });
      this.reapOldestFinished();
      this.scheduleFinishedReap();
    }

    this.ensureWatcherRunning();
    this.stopWatcherIfIdle();
  }

  async kill(
    id: string,
    opts?: { signal?: NodeJS.Signals; timeoutMs?: number },
  ): Promise<KillResult> {
    const managed = this.registry.getRecord(id);
    if (!managed) {
      return {
        ok: false,
        info: {
          id,
          name: "(unknown)",
          pid: -1,
          command: "",
          cwd: "",
          startTime: 0,
          endTime: null,
          status: "exited",
          exitCode: null,
          success: false,
          stdoutFile: "",
          stderrFile: "",
          endReason: null,
          signal: null,
          errorMessage: null,
        },
        reason: "not_found",
      };
    }

    const signal = opts?.signal ?? "SIGTERM";
    const timeoutMs = opts?.timeoutMs ?? 3000;

    if (!LIVE_STATUSES.has(managed.status)) {
      return { ok: true, info: formatProcess(managed) };
    }

    this.transition(managed, "terminating");

    try {
      killProcessGroup(managed.pid, signal);
      managed.lastSignalSent = signal;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EPERM") {
        return {
          ok: false,
          info: formatProcess(managed),
          reason: "error",
        };
      }
    }

    const graceMs = signal === "SIGKILL" ? 200 : timeoutMs;
    await new Promise((r) => setTimeout(r, graceMs));

    const alive = isProcessGroupAlive(managed.pid);

    if (alive) {
      managed.endReason = "kill_timeout";
      managed.signal = formatSignalInfo(signal);
      managed.success = false;
      // Record the death timestamp so the subsequent `close` event does not
      // re-transition the process and clobber the timeout result. Without
      // this, `child.on("close")` sees a null endTime, overwrites endReason
      // to "signal", and emits a second (reclassified) process_ended.
      managed.endTime = Date.now();
      this.transition(managed, "terminate_timeout");
      return {
        ok: false,
        info: formatProcess(managed),
        reason: "timeout",
      };
    }

    if (!managed.endTime) {
      managed.endTime = Date.now();
      managed.exitCode = null;
      managed.success = false;
    }

    if (managed.lastSignalSent) {
      managed.endReason = "signal";
      managed.signal = formatSignalInfo(managed.lastSignalSent);
    } else {
      managed.endReason = "lost";
      managed.signal = null;
    }

    this.output.flush(managed);
    this.releaseRuntimeHandles(managed);
    this.transition(managed, "killed");
    return { ok: true, info: formatProcess(managed) };
  }

  killAll(): void {
    for (const p of this.registry.values()) {
      if (!LIVE_STATUSES.has(p.status)) continue;
      try {
        killProcessGroup(p.pid, "SIGKILL");
      } catch (_error) {
        void _error; // Intentionally ignored - process may already be dead
      }
    }
  }

  writeToStdin(
    id: string,
    data: string,
    opts?: { end?: boolean },
  ): WriteResult {
    const managed = this.registry.getRecord(id);
    if (!managed) {
      return {
        ok: false,
        reason: "not_found",
      };
    }

    if (!LIVE_STATUSES.has(managed.status)) {
      return {
        ok: false,
        reason: "process_exited",
      };
    }

    if (managed.stdinClosed || !managed.stdin) {
      return {
        ok: false,
        reason: "stdin_closed",
      };
    }

    try {
      managed.stdin.write(data);

      if (opts?.end) {
        managed.stdin.end();
        managed.stdinClosed = true;
      }

      return { ok: true };
    } catch (_error) {
      return {
        ok: false,
        reason: "write_error",
      };
    }
  }

  clearFinished(): number {
    let cleared = 0;
    for (const managed of this.registry.values()) {
      if (LIVE_STATUSES.has(managed.status)) {
        continue;
      }

      this.removeFinishedRecord(managed);
      cleared++;
    }

    if (cleared > 0) {
      this.emit({ type: "processes_changed" });
    }

    this.scheduleFinishedReap();
    this.stopWatcherIfIdle();
    return cleared;
  }

  stopWatcher(): void {
    if (this.watcher) {
      clearInterval(this.watcher);
      this.watcher = null;
    }
  }

  stopFinishedReaper(): void {
    if (!this.finishedReapTimer) return;
    clearTimeout(this.finishedReapTimer);
    this.finishedReapTimer = null;
  }

  beginShutdown(): void {
    this.shuttingDown = true;
    this.stopFinishedReaper();
  }

  /**
   * Kill all live processes (used by cleanup on actual pi exit).
   */
  killAllLive(): void {
    for (const p of this.registry.values()) {
      if (!LIVE_STATUSES.has(p.status)) continue;
      try {
        killProcessGroup(p.pid, "SIGKILL");
      } catch (_error) {
        void _error; // Intentionally ignored - process may already be dead
      }
    }
  }

  [Symbol.dispose](): void {
    this.stopWatcher();
    this.beginShutdown();
    this.killAllLive();
  }

  private wireStdioHandlers(
    managed: ManagedProcessRecord,
    child: ChildProcess,
  ): void {
    child.stdout?.on("data", (data: Buffer) => {
      this.logs.appendStdout(managed.stdoutFile, data);
      this.output.onStdoutChunk(managed, data);
    });

    child.stderr?.on("data", (data: Buffer) => {
      this.logs.appendStderr(managed.stderrFile, data);
      this.output.onStderrChunk(managed, data);
    });

    child.on("close", (code, signal) => {
      this.releaseRuntimeHandles(managed);
      if (managed.endTime) return;

      managed.exitCode = code;
      managed.endTime = Date.now();

      this.output.flush(managed);

      if (signal) {
        managed.success = false;
        managed.endReason = "signal";
        managed.signal = formatSignalInfo(signal);
        this.transition(managed, "killed");
      } else {
        managed.success = code === 0;
        managed.endReason = "exit";
        managed.signal = null;
        this.transition(managed, "exited");
      }
    });

    child.on("error", (err) => {
      this.handleSpawnError(managed, err);
    });
  }

  private handleSpawnError(
    managed: ManagedProcessRecord,
    err: NodeJS.ErrnoException,
  ): void {
    this.logs.appendErrorLine(
      managed.stderrFile,
      `Process error: ${err.message}`,
    );

    if (managed.endTime) return;

    this.releaseRuntimeHandles(managed);
    managed.exitCode = -1;
    managed.success = false;
    managed.endReason = "spawn_error";
    managed.errorMessage = err.message;
    managed.endTime = Date.now();
    this.output.flush(managed);
    this.transition(managed, "exited");
  }

  private ensureWatcherRunning(): void {
    if (this.watcher) return;
    if (!this.registry.hasAliveishProcesses()) return;

    this.watcher = setInterval(() => {
      this.livenessTick();
    }, 5000);
  }

  private stopWatcherIfIdle(): void {
    if (!this.watcher) return;
    if (this.registry.hasAliveishProcesses()) return;

    this.stopWatcher();
  }

  private livenessTick(): void {
    for (const managed of this.registry.values()) {
      if (!LIVE_STATUSES.has(managed.status)) continue;
      // A timed-out process was already finalized by kill() (endReason
      // kill_timeout, endTime set, terminate_timeout status, and a tool
      // result carrying reason:"timeout"). The tick's job is to detect
      // autonomous deaths of running processes; reclassifying a finalized
      // timeout here would clobber endReason/signal to "lost" and emit a
      // second process_ended. The close handler also bails via the endTime
      // guard, so the timeout classification is preserved as-is.
      if (managed.status === "terminate_timeout") continue;
      if (!managed.pid || managed.pid <= 0) continue;

      const alive = isProcessGroupAlive(managed.pid);
      if (alive) continue;

      if (!managed.endTime) {
        managed.endTime = Date.now();
      }

      this.output.flush(managed);
      this.releaseRuntimeHandles(managed);

      managed.success = false;
      managed.exitCode = null;
      managed.endReason = "lost";

      if (managed.lastSignalSent) {
        managed.signal = formatSignalInfo(managed.lastSignalSent);
        this.transition(managed, "killed");
      } else {
        managed.signal = null;
        this.transition(managed, "exited");
      }
    }
  }

  private releaseRuntimeHandles(managed: ManagedProcessRecord): void {
    managed.stdin = null;
    managed.stdinClosed = true;
  }

  private reapOldestFinished(): void {
    const finished = this.finishedRecordsByAge();
    if (finished.length <= MAX_FINISHED_RECORDS) return;

    const cutoff = Date.now() - FINISHED_RECORD_GRACE_MS;
    let remaining = finished.length;
    let reaped = 0;
    for (const record of finished) {
      if (remaining <= MAX_FINISHED_RECORDS) break;
      if ((record.endTime ?? Number.POSITIVE_INFINITY) > cutoff) break;
      this.removeFinishedRecord(record);
      remaining--;
      reaped++;
    }

    if (reaped > 0) this.emit({ type: "processes_changed" });
  }

  private scheduleFinishedReap(): void {
    this.stopFinishedReaper();
    if (this.shuttingDown) return;
    const finished = this.finishedRecordsByAge();
    if (finished.length <= MAX_FINISHED_RECORDS) return;

    const oldest = finished[0];
    const delay = Math.max(
      0,
      (oldest.endTime ?? Date.now()) + FINISHED_RECORD_GRACE_MS - Date.now(),
    );
    this.finishedReapTimer = setTimeout(() => {
      this.finishedReapTimer = null;
      this.reapOldestFinished();
      this.scheduleFinishedReap();
    }, delay);
    this.finishedReapTimer.unref?.();
  }

  private finishedRecordsByAge(): ManagedProcessRecord[] {
    return [...this.registry.values()]
      .filter(
        (record) =>
          !LIVE_STATUSES.has(record.status) && record.endTime !== null,
      )
      .sort(
        (a, b) =>
          (a.endTime ?? 0) - (b.endTime ?? 0) ||
          (a.completionSequence ?? 0) - (b.completionSequence ?? 0),
      );
  }

  private removeFinishedRecord(record: ManagedProcessRecord): void {
    this.logs.removeLogs({
      stdoutFile: record.stdoutFile,
      stderrFile: record.stderrFile,
      combinedFile: record.combinedFile,
    });
    this.output.clear(record.id);
    this.registry.delete(record.id);
  }
}
