import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";

import {
  type KillResult,
  LIVE_STATUSES,
  type LogWatch,
  type LogWatchStream,
  type ManagerEvent,
  type ProcessInfo,
  type ProcessStatus,
  type StartOptions,
  type WriteResult,
} from "./constants";
import { isProcessGroupAlive, killProcessGroup } from "./utils";
import { spawnCommand } from "./utils/command-executor";

interface ResolvedWatch {
  index: number;
  pattern: string;
  regex: RegExp;
  stream: LogWatchStream;
  repeat: boolean;
  fired: boolean;
  maxWakes?: number;
  dedupe?: boolean;
}

interface ManagedProcess extends ProcessInfo {
  process: ChildProcess;
  stdin: Writable | null;
  stdinClosed: boolean;
  lastSignalSent: NodeJS.Signals | null;
  combinedFile: string;
  stdoutPendingLine: string;
  stderrPendingLine: string;
  watches: ResolvedWatch[];
  /** Timestamp when livenessTick first detected the PID was gone (defers transition to let close event fire). */
  polledDeadAt: number | null;
}

interface ProcessManagerOptions {
  getConfiguredShellPath?: () => string | undefined;
  /**
   * Finished-process retention cap read at every process end. 0 disables
   * automatic pruning (finished records stay until `clearFinished`).
   */
  getMaxFinished?: () => number;
}

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private counter = 0;
  private logDir: string;
  private events = new EventEmitter();
  private watcher: ReturnType<typeof setInterval> | null = null;
  private getConfiguredShellPath: () => string | undefined;
  private getMaxFinished: () => number;

  private lastOutputEmitAt: Map<string, number> = new Map();
  private pendingOutputEmit: Map<string, NodeJS.Timeout> = new Map();

  constructor(options?: ProcessManagerOptions) {
    this.logDir = join(tmpdir(), `pi-processes-${Date.now()}`);
    mkdirSync(this.logDir, { recursive: true });
    this.getConfiguredShellPath =
      options?.getConfiguredShellPath ?? (() => undefined);
    this.getMaxFinished = options?.getMaxFinished ?? (() => 0);
  }

  onEvent(listener: (event: ManagerEvent) => void): () => void {
    this.events.on("event", listener);
    return () => this.events.off("event", listener);
  }

  private emit(event: ManagerEvent): void {
    this.events.emit("event", event);
  }

  private notifyOutputChanged(id: string): void {
    const now = Date.now();
    const lastEmit = this.lastOutputEmitAt.get(id) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= 100) {
      this.lastOutputEmitAt.set(id, now);
      this.emit({ type: "process_output_changed", id });
      return;
    }

    if (!this.pendingOutputEmit.has(id)) {
      const delay = 100 - elapsed;
      const timeout = setTimeout(() => {
        this.pendingOutputEmit.delete(id);
        // Invariant: every path that removes a process from `this.processes`
        // must call `clearOutputChangedState(id)` first, which clears this
        // timeout. This guard is a safety net, not a primary mechanism.
        if (!this.processes.has(id)) return;
        this.lastOutputEmitAt.set(id, Date.now());
        this.emit({ type: "process_output_changed", id });
      }, delay);
      this.pendingOutputEmit.set(id, timeout);
    }
  }

  private flushPendingOutputChanged(id: string): void {
    const timeout = this.pendingOutputEmit.get(id);
    if (!timeout) return;
    clearTimeout(timeout);
    this.pendingOutputEmit.delete(id);
    this.lastOutputEmitAt.set(id, Date.now());
    this.emit({ type: "process_output_changed", id });
  }

  private clearOutputChangedState(id: string): void {
    const timeout = this.pendingOutputEmit.get(id);
    if (timeout) clearTimeout(timeout);
    this.pendingOutputEmit.delete(id);
    this.lastOutputEmitAt.delete(id);
  }

  private transition(managed: ManagedProcess, next: ProcessStatus): void {
    if (managed.status === next) return;
    managed.status = next;

    if (next === "exited" || next === "killed") {
      this.emit({ type: "process_ended", info: this.toProcessInfo(managed) });
      this.pruneFinished(this.getMaxFinished());
    }

    this.ensureWatcherRunning();
    this.stopWatcherIfIdle();
  }

  /**
   * Drop the oldest finished records beyond `maxFinished`, keeping the list
   * bounded without an explicit `clear`. Log files stay on disk: the paths
   * returned by `start` and `logs` remain readable after the record is gone.
   * `maxFinished <= 0` keeps everything. Returns the pruned ids.
   */
  pruneFinished(maxFinished: number): string[] {
    if (maxFinished <= 0) return [];

    const finished = [...this.processes.values()]
      .filter((p) => !LIVE_STATUSES.has(p.status))
      .sort((a, b) => (a.endTime ?? 0) - (b.endTime ?? 0));
    const excess = finished.length - maxFinished;
    if (excess <= 0) return [];

    const pruned: string[] = [];
    for (const managed of finished.slice(0, excess)) {
      this.clearOutputChangedState(managed.id);
      this.processes.delete(managed.id);
      pruned.push(managed.id);
    }

    this.emit({ type: "processes_changed" });
    return pruned;
  }

  private ensureWatcherRunning(): void {
    if (this.watcher) return;
    if (!this.hasAliveishProcesses()) return;

    this.watcher = setInterval(() => {
      this.livenessTick();
    }, 5000);
  }

  private stopWatcherIfIdle(): void {
    if (!this.watcher) return;
    if (this.hasAliveishProcesses()) return;

    clearInterval(this.watcher);
    this.watcher = null;
  }

  private hasAliveishProcesses(): boolean {
    for (const p of this.processes.values()) {
      if (LIVE_STATUSES.has(p.status)) return true;
    }
    return false;
  }

  private livenessTick(): void {
    for (const managed of this.processes.values()) {
      if (!LIVE_STATUSES.has(managed.status)) continue;
      if (!managed.pid || managed.pid <= 0) continue;

      const alive = isProcessGroupAlive(managed.pid);
      if (alive) {
        managed.polledDeadAt = null;
        continue;
      }

      // Signal-killed: transition immediately — we know the outcome.
      if (managed.lastSignalSent) {
        if (!managed.endTime) {
          managed.endTime = Date.now();
        }
        this.flushPendingOutputChanged(managed.id);
        this.flushPendingLines(managed);
        managed.success = false;
        managed.exitCode = null;
        this.transition(managed, "killed");
        continue;
      }

      // Natural exit: defer one tick to let child.on("close") deliver
      // the real exit code before we force-transition with exitCode=null.
      if (!managed.polledDeadAt) {
        managed.polledDeadAt = Date.now();
        continue;
      }

      // Second tick — close event never fired; force-transition as fallback.
      if (!managed.endTime) {
        managed.endTime = Date.now();
      }

      this.flushPendingOutputChanged(managed.id);
      this.flushPendingLines(managed);

      managed.success = false;
      managed.exitCode = null;
      this.transition(managed, "exited");
    }
  }

  start(
    name: string,
    command: string,
    cwd: string,
    options?: StartOptions,
  ): ProcessInfo {
    const resolvedWatches = this.resolveLogWatches(options?.logWatches);
    const id = `proc_${++this.counter}`;
    const stdoutFile = join(this.logDir, `${id}-stdout.log`);
    const stderrFile = join(this.logDir, `${id}-stderr.log`);
    const combinedFile = join(this.logDir, `${id}-combined.log`);

    appendFileSync(stdoutFile, "");
    appendFileSync(stderrFile, "");
    appendFileSync(combinedFile, "");

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
      stdoutFile,
      stderrFile,
      combinedFile,
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
      polledDeadAt: null,
    };

    this.processes.set(id, managed);

    if (!child.pid) {
      try {
        appendFileSync(stderrFile, "Spawn error: missing pid\n");
      } catch {
        // Ignore
      }
      managed.exitCode = -1;
      managed.success = false;
      managed.endTime = Date.now();
      this.transition(managed, "exited");
      return this.toProcessInfo(managed);
    }

    child.stdout?.on("data", (data: Buffer) => {
      try {
        appendFileSync(stdoutFile, data);
        const lines = this.extractCompleteLines(managed, "stdout", data);
        const tagged = lines.map((line) => `1:${line}\n`).join("");
        if (tagged) appendFileSync(combinedFile, tagged);
        this.matchWatches(managed, "stdout", lines);
        this.notifyOutputChanged(id);
      } catch {
        // Ignore
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      try {
        appendFileSync(stderrFile, data);
        const lines = this.extractCompleteLines(managed, "stderr", data);
        const tagged = lines.map((line) => `2:${line}\n`).join("");
        if (tagged) appendFileSync(combinedFile, tagged);
        this.matchWatches(managed, "stderr", lines);
        this.notifyOutputChanged(id);
      } catch {
        // Ignore
      }
    });

    child.on("close", (code, signal) => {
      // The close event carries the authoritative exit code.
      // Always apply it — even if livenessTick already set endTime
      // (race). Only skip the transition if already transitioned.
      const alreadyTransitioned = !LIVE_STATUSES.has(managed.status);

      managed.exitCode = code;
      managed.endTime ??= Date.now();
      managed.success = code === 0;
      managed.polledDeadAt = null;

      this.flushPendingOutputChanged(id);
      this.flushPendingLines(managed);

      if (!alreadyTransitioned) {
        if (signal) {
          this.transition(managed, "killed");
        } else {
          this.transition(managed, "exited");
        }
      }
      // If already transitioned by livenessTick fallback, metadata is
      // now corrected silently. Subsequent get() calls return the real
      // exit code. We don't re-emit process_ended to avoid double alerts.
    });

    child.on("error", (err) => {
      try {
        appendFileSync(stderrFile, `Process error: ${err.message}\n`);
      } catch {
        // Ignore
      }

      if (!managed.endTime) {
        managed.exitCode = -1;
        managed.success = false;
        managed.endTime = Date.now();
        this.flushPendingOutputChanged(id);
        this.flushPendingLines(managed);
        this.transition(managed, "exited");
      }
    });

    this.emit({ type: "process_started", info: this.toProcessInfo(managed) });
    this.ensureWatcherRunning();

    return this.toProcessInfo(managed);
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.values())
      .map((p) => this.toProcessInfo(p))
      .reverse();
  }

  get(id: string): ProcessInfo | null {
    const managed = this.processes.get(id);
    return managed ? this.toProcessInfo(managed) : null;
  }

  getOutput(
    id: string,
    tailLines = 100,
  ): { stdout: string[]; stderr: string[]; status: string } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    return {
      stdout: this.readTailLines(managed.stdoutFile, tailLines),
      stderr: this.readTailLines(managed.stderrFile, tailLines),
      status: managed.status,
    };
  }

  getCombinedOutput(
    id: string,
    tailLines = 100,
  ): { type: "stdout" | "stderr"; text: string }[] | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    const rawLines = this.readTailLines(managed.combinedFile, tailLines);
    return rawLines.map((line) => {
      if (line.startsWith("2:")) {
        return { type: "stderr", text: line.slice(2) };
      }
      // Default to stdout (handles "1:" prefix and any malformed lines).
      return {
        type: "stdout",
        text: line.startsWith("1:") ? line.slice(2) : line,
      };
    });
  }

  getFullOutput(id: string): { stdout: string; stderr: string } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    try {
      return {
        stdout: readFileSync(managed.stdoutFile, "utf-8"),
        stderr: readFileSync(managed.stderrFile, "utf-8"),
      };
    } catch {
      return { stdout: "", stderr: "" };
    }
  }

  getLogFiles(
    id: string,
  ): { stdoutFile: string; stderrFile: string; combinedFile: string } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;
    return {
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
      combinedFile: managed.combinedFile,
    };
  }

  async kill(
    id: string,
    opts?: { signal?: NodeJS.Signals; timeoutMs?: number },
  ): Promise<KillResult> {
    const managed = this.processes.get(id);
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
      return { ok: true, info: this.toProcessInfo(managed) };
    }

    this.transition(managed, "terminating");

    try {
      killProcessGroup(managed.pid, signal);
      managed.lastSignalSent = signal;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // ESRCH: process already dead (e.g. during deferred-dead window).
      // Treat as successful kill — fall through to the alive check below.
      if (err.code !== "EPERM" && err.code !== "ESRCH") {
        return {
          ok: false,
          info: this.toProcessInfo(managed),
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
        info: this.toProcessInfo(managed),
        reason: "timeout",
      };
    }

    if (!managed.endTime) {
      managed.endTime = Date.now();
      managed.exitCode = null;
      managed.success = false;
    }

    this.flushPendingOutputChanged(id);
    this.flushPendingLines(managed);
    this.transition(managed, "killed");
    return { ok: true, info: this.toProcessInfo(managed) };
  }

  writeToStdin(
    id: string,
    data: string,
    opts?: { end?: boolean },
  ): WriteResult {
    const managed = this.processes.get(id);
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
    } catch {
      return {
        ok: false,
        reason: "write_error",
      };
    }
  }

  clearFinished(): number {
    let cleared = 0;
    for (const [id, managed] of this.processes) {
      if (LIVE_STATUSES.has(managed.status)) {
        continue;
      }

      try {
        rmSync(managed.stdoutFile, { force: true });
        rmSync(managed.stderrFile, { force: true });
        rmSync(managed.combinedFile, { force: true });
      } catch {
        // Ignore
      }

      this.clearOutputChangedState(id);
      this.processes.delete(id);
      cleared++;
    }

    if (cleared > 0) {
      this.emit({ type: "processes_changed" });
    }

    this.stopWatcherIfIdle();
    return cleared;
  }

  shutdownKillAll(): void {
    for (const p of this.processes.values()) {
      if (!LIVE_STATUSES.has(p.status)) continue;
      try {
        killProcessGroup(p.pid, "SIGKILL");
      } catch {
        // Ignore - process may already be dead
      }
    }
  }

  stopWatcher(): void {
    if (this.watcher) {
      clearInterval(this.watcher);
      this.watcher = null;
    }
  }

  cleanup(): void {
    this.stopWatcher();

    for (const timeout of this.pendingOutputEmit.values()) {
      clearTimeout(timeout);
    }
    this.pendingOutputEmit.clear();
    this.lastOutputEmitAt.clear();

    for (const p of this.processes.values()) {
      if (!LIVE_STATUSES.has(p.status)) continue;
      try {
        killProcessGroup(p.pid, "SIGKILL");
      } catch {
        // Ignore
      }
    }

    try {
      rmSync(this.logDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  getFileSize(id: string): { stdout: number; stderr: number } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;

    try {
      return {
        stdout: statSync(managed.stdoutFile).size,
        stderr: statSync(managed.stderrFile).size,
      };
    } catch {
      return { stdout: 0, stderr: 0 };
    }
  }

  private resolveLogWatches(input?: LogWatch[]): ResolvedWatch[] {
    if (!input || input.length === 0) return [];

    return input.map((watch, index) => {
      const pattern = watch.pattern?.trim();
      if (!pattern) {
        throw new Error(`logWatches[${index}].pattern is required`);
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "invalid regular expression";
        throw new Error(
          `Invalid log watch pattern at logWatches[${index}]: ${message}`,
        );
      }

      const stream = watch.stream ?? "both";
      if (stream !== "stdout" && stream !== "stderr" && stream !== "both") {
        throw new Error(
          `Invalid logWatches[${index}].stream: ${stream}. Expected stdout, stderr, or both`,
        );
      }

      let maxWakes: number | undefined;
      if (watch.maxWakes !== undefined) {
        if (
          typeof watch.maxWakes !== "number" ||
          !Number.isInteger(watch.maxWakes) ||
          watch.maxWakes < 0
        ) {
          throw new Error(
            `Invalid logWatches[${index}].maxWakes: expected a non-negative integer`,
          );
        }
        maxWakes = watch.maxWakes;
      }

      return {
        index,
        pattern,
        regex,
        stream,
        repeat: watch.repeat ?? false,
        fired: false,
        maxWakes,
        dedupe: watch.dedupe ?? undefined,
      };
    });
  }

  private extractCompleteLines(
    managed: ManagedProcess,
    source: "stdout" | "stderr",
    data: Buffer,
  ): string[] {
    const chunk = data.toString();
    const pending =
      source === "stdout"
        ? managed.stdoutPendingLine
        : managed.stderrPendingLine;
    const merged = pending + chunk;
    const parts = merged.split(/\r?\n/);
    const completeLines = parts.slice(0, -1);
    const nextPending = parts[parts.length - 1] ?? "";

    if (source === "stdout") {
      managed.stdoutPendingLine = nextPending;
    } else {
      managed.stderrPendingLine = nextPending;
    }

    return completeLines;
  }

  private flushPendingLines(managed: ManagedProcess): void {
    if (managed.stdoutPendingLine) {
      try {
        appendFileSync(
          managed.combinedFile,
          `1:${managed.stdoutPendingLine}\n`,
        );
      } catch {
        // Ignore
      }
      this.matchWatches(managed, "stdout", [managed.stdoutPendingLine]);
      managed.stdoutPendingLine = "";
    }

    if (managed.stderrPendingLine) {
      try {
        appendFileSync(
          managed.combinedFile,
          `2:${managed.stderrPendingLine}\n`,
        );
      } catch {
        // Ignore
      }
      this.matchWatches(managed, "stderr", [managed.stderrPendingLine]);
      managed.stderrPendingLine = "";
    }
  }

  private matchWatches(
    managed: ManagedProcess,
    source: "stdout" | "stderr",
    lines: string[],
  ): void {
    if (managed.watches.length === 0 || lines.length === 0) return;

    for (const line of lines) {
      for (const watch of managed.watches) {
        if (!watch.repeat && watch.fired) continue;
        if (watch.stream !== "both" && watch.stream !== source) continue;

        if (!watch.regex.test(line)) continue;

        watch.fired = true;

        this.emit({
          type: "process_watch_matched",
          match: {
            processId: managed.id,
            processName: managed.name,
            processCommand: managed.command,
            source,
            line,
            watch: {
              index: watch.index,
              pattern: watch.pattern,
              stream: watch.stream,
              repeat: watch.repeat,
              maxWakes: watch.maxWakes,
              dedupe: watch.dedupe,
            },
          },
        });
      }
    }
  }

  private readTailLines(filePath: string, lines: number): string[] {
    try {
      const content = readFileSync(filePath, "utf-8");
      const allLines = content.split("\n");
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      return allLines.slice(-lines);
    } catch {
      return [];
    }
  }

  private toProcessInfo(managed: ManagedProcess): ProcessInfo {
    return {
      id: managed.id,
      name: managed.name,
      pid: managed.pid,
      command: managed.command,
      cwd: managed.cwd,
      startTime: managed.startTime,
      endTime: managed.endTime,
      status: managed.status,
      exitCode: managed.exitCode,
      success: managed.success,
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
      alertOnSuccess: managed.alertOnSuccess,
      alertOnFailure: managed.alertOnFailure,
      alertOnKill: managed.alertOnKill,
    };
  }
}

export type {
  KillResult,
  ManagerEvent,
  ProcessInfo,
  ProcessStatus,
  WriteResult,
};
