import type { ChildProcess } from "node:child_process";

import type { KillResult, ManagerEvent, WriteResult } from "../types";
import { LIVE_STATUSES } from "../types";
import { isProcessGroupAlive, killProcessGroup } from "../utils";
import { spawnCommand } from "../utils/command-executor";
import { formatSignalInfo } from "../utils/signals";
import type { ManagedProcessRecord } from "./internal-types";
import { formatProcess } from "./internal-types";
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

  constructor(deps: ProcessRuntimeControllerDeps) {
    this.registry = deps.registry;
    this.logs = deps.logs;
    this.output = deps.output;
    this.emit = deps.emit;
    this.getConfiguredShellPath = deps.getConfiguredShellPath;
  }

  start(name: string, command: string, cwd: string): ManagedProcessRecord {
    const id = this.registry.nextId();
    const logPaths = this.logs.createLogs(id);

    const child = spawnCommand(command, cwd, this.getConfiguredShellPath());
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
      startTime: Date.now(),
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
      process: child,
      stdin: child.stdin,
      stdinClosed: false,
      lastSignalSent: null,
      stdoutPendingLine: "",
      stderrPendingLine: "",
      appendedLines: [],
    };

    this.registry.add(managed);

    if (!child.pid) {
      this.logs.appendErrorLine(managed.stderrFile, "Spawn error: missing pid");
      managed.exitCode = -1;
      managed.success = false;
      managed.endReason = "missing_pid";
      managed.errorMessage = "Spawn error: missing pid";
      managed.endTime = Date.now();
      this.transition(managed, "exited");
      return managed;
    }

    this.wireStdioHandlers(managed, child);

    this.emit({ type: "process_started", info: formatProcess(managed) });
    this.ensureWatcherRunning();

    return managed;
  }

  transition(managed: ManagedProcessRecord, next: typeof managed.status): void {
    if (managed.status === next) return;
    managed.status = next;

    if (next === "exited" || next === "killed") {
      this.emit({ type: "process_ended", info: formatProcess(managed) });
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
    for (const [id, managed] of this.registry.entries()) {
      if (LIVE_STATUSES.has(managed.status)) {
        continue;
      }

      this.logs.removeLogs({
        stdoutFile: managed.stdoutFile,
        stderrFile: managed.stderrFile,
        combinedFile: managed.combinedFile,
      });

      this.output.clear(id);
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
      this.logs.appendErrorLine(
        managed.stderrFile,
        `Process error: ${err.message}`,
      );

      if (!managed.endTime) {
        managed.exitCode = -1;
        managed.success = false;
        managed.endReason = "spawn_error";
        managed.errorMessage = err.message;
        managed.endTime = Date.now();
        this.output.flush(managed);
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

      this.output.flush(managed);

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
}
