import type { ChildProcess } from "node:child_process";

import type {
  AddLogWatchesResult,
  KillResult,
  LogWatch,
  StartOptions,
  WriteResult,
} from "../types";
import { LIVE_STATUSES } from "../types";
import { isProcessGroupAlive, killProcessGroup } from "../utils";
import { spawnCommand } from "../utils/command-executor";
import type { ManagedProcess } from "./internal-types";
import { publicProcessInfo } from "./internal-types";
import type { OutputChangeNotifier } from "./output-change-notifier";
import type { ProcessLogStore } from "./process-log-store";
import type { ProcessOutputTracker } from "./process-output-tracker";
import type { ProcessRegistry } from "./process-registry";

interface ProcessRuntimeControllerDeps {
  registry: ProcessRegistry;
  logs: ProcessLogStore;
  outputTracker: ProcessOutputTracker;
  outputNotifier: OutputChangeNotifier;
  emit: (event: ManagerEvent) => void;
  getConfiguredShellPath: () => string | undefined;
}

import type { ManagerEvent } from "../types";

export class ProcessRuntimeController {
  private registry: ProcessRegistry;
  private logs: ProcessLogStore;
  private outputTracker: ProcessOutputTracker;
  private outputNotifier: OutputChangeNotifier;
  private emit: (event: ManagerEvent) => void;
  private getConfiguredShellPath: () => string | undefined;

  private watcher: ReturnType<typeof setInterval> | null = null;

  constructor(deps: ProcessRuntimeControllerDeps) {
    this.registry = deps.registry;
    this.logs = deps.logs;
    this.outputTracker = deps.outputTracker;
    this.outputNotifier = deps.outputNotifier;
    this.emit = deps.emit;
    this.getConfiguredShellPath = deps.getConfiguredShellPath;
  }

  start(
    name: string,
    command: string,
    cwd: string,
    options?: StartOptions,
  ): ManagedProcess {
    const resolvedWatches = this.outputTracker.resolveLogWatches(
      options?.logWatches,
    );
    const id = this.registry.nextId();
    const logPaths = this.logs.createLogs(id);

    const child = spawnCommand(command, cwd, this.getConfiguredShellPath());
    child.unref();

    const managed: ManagedProcess = {
      id,
      name,
      pid: child.pid ?? -1,
      command,
      cwd,
      startTime: Date.now(),
      endTime: null,
      status: "running",
      exitCode: null,
      success: null,
      stdoutFile: logPaths.stdoutFile,
      stderrFile: logPaths.stderrFile,
      combinedFile: logPaths.combinedFile,
      alertOnSuccess: options?.alertOnSuccess ?? false,
      alertOnFailure: options?.alertOnFailure ?? true,
      alertOnKill: options?.alertOnKill ?? false,
      process: child,
      stdin: child.stdin,
      stdinClosed: false,
      lastSignalSent: null,
      stdoutPendingLine: "",
      stderrPendingLine: "",
      watches: resolvedWatches,
      appendedLines: [],
    };

    this.registry.add(managed);

    if (!child.pid) {
      this.logs.appendErrorLine(managed.stderrFile, "Spawn error: missing pid");
      managed.exitCode = -1;
      managed.success = false;
      managed.endTime = Date.now();
      this.transition(managed, "exited");
      return managed;
    }

    this.wireStdioHandlers(managed, child);

    this.emit({ type: "process_started", info: publicProcessInfo(managed) });
    this.ensureWatcherRunning();

    return managed;
  }

  transition(managed: ManagedProcess, next: typeof managed.status): void {
    if (managed.status === next) return;
    managed.status = next;

    if (next === "exited" || next === "killed") {
      this.emit({ type: "process_ended", info: publicProcessInfo(managed) });
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
          alertOnSuccess: false,
          alertOnFailure: true,
          alertOnKill: false,
        },
        reason: "not_found",
      };
    }

    const signal = opts?.signal ?? "SIGTERM";
    const timeoutMs = opts?.timeoutMs ?? 3000;

    managed.alertOnKill = false;

    if (!LIVE_STATUSES.has(managed.status)) {
      return { ok: true, info: publicProcessInfo(managed) };
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
          info: publicProcessInfo(managed),
          reason: "error",
        };
      }
    }

    const graceMs = signal === "SIGKILL" ? 200 : timeoutMs;
    await new Promise((r) => setTimeout(r, graceMs));

    const alive = isProcessGroupAlive(managed.pid);

    if (alive) {
      this.transition(managed, "terminate_timeout");
      return {
        ok: false,
        info: publicProcessInfo(managed),
        reason: "timeout",
      };
    }

    if (!managed.endTime) {
      managed.endTime = Date.now();
      managed.exitCode = null;
      managed.success = false;
    }

    this.outputTracker.flushPendingLines(managed);
    this.outputNotifier.flush(id);
    this.transition(managed, "killed");
    return { ok: true, info: publicProcessInfo(managed) };
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

  addLogWatches(id: string, watches: LogWatch[]): AddLogWatchesResult {
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

    const resolved = this.outputTracker.resolveLogWatches(
      watches,
      managed.watches.length,
    );
    managed.watches.push(...resolved);

    return {
      ok: true,
      added: resolved.length,
    };
  }

  clearFinished(): number {
    let cleared = 0;
    for (const [id, managed] of this.registry.entries()) {
      if (LIVE_STATUSES.has(managed.status)) {
        continue;
      }

      this.logs.removeLogs({
        stdoutFile: managed.stdoutFile,
        stderrFile: managed.stderrFile,
        combinedFile: managed.combinedFile,
      });

      this.outputNotifier.clear(id);
      this.registry.delete(id);
      cleared++;
    }

    if (cleared > 0) {
      this.emit({ type: "processes_changed" });
    }

    this.stopWatcherIfIdle();
    return cleared;
  }

  stopWatcher(): void {
    if (this.watcher) {
      clearInterval(this.watcher);
      this.watcher = null;
    }
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
    this.killAllLive();
  }

  private wireStdioHandlers(
    managed: ManagedProcess,
    child: ChildProcess,
  ): void {
    child.stdout?.on("data", (data: Buffer) => {
      this.logs.appendStdout(managed.stdoutFile, data);
      this.outputTracker.onStdoutChunk(managed, data);
      this.outputNotifier.notify(managed.id);
    });

    child.stderr?.on("data", (data: Buffer) => {
      this.logs.appendStderr(managed.stderrFile, data);
      this.outputTracker.onStderrChunk(managed, data);
      this.outputNotifier.notify(managed.id);
    });

    child.on("close", (code, signal) => {
      if (managed.endTime) return;

      managed.exitCode = code;
      managed.endTime = Date.now();
      managed.success = code === 0;

      this.outputTracker.flushPendingLines(managed);
      this.outputNotifier.flush(managed.id);

      if (signal) {
        this.transition(managed, "killed");
      } else {
        this.transition(managed, "exited");
      }
    });

    child.on("error", (err) => {
      this.logs.appendErrorLine(
        managed.stderrFile,
        `Process error: ${err.message}`,
      );

      if (!managed.endTime) {
        managed.exitCode = -1;
        managed.success = false;
        managed.endTime = Date.now();
        this.outputTracker.flushPendingLines(managed);
        this.outputNotifier.flush(managed.id);
        this.transition(managed, "exited");
      }
    });
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

    clearInterval(this.watcher);
    this.watcher = null;
  }

  private livenessTick(): void {
    for (const managed of this.registry.values()) {
      if (!LIVE_STATUSES.has(managed.status)) continue;
      if (!managed.pid || managed.pid <= 0) continue;

      const alive = isProcessGroupAlive(managed.pid);
      if (alive) continue;

      if (!managed.endTime) {
        managed.endTime = Date.now();
      }

      this.outputTracker.flushPendingLines(managed);
      this.outputNotifier.flush(managed.id);

      if (managed.lastSignalSent) {
        managed.success = false;
        managed.exitCode = null;
        this.transition(managed, "killed");
      } else {
        managed.success = false;
        managed.exitCode = null;
        this.transition(managed, "exited");
      }
    }
  }
}
