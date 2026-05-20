import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  appendFileSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
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
  type LogWatchInfo,
  type LogWatchReplayMatch,
  type LogWatchStream,
  type LogWatchUpdate,
  type ManagerEvent,
  type ProcessInfo,
  type ProcessMetadataUpdate,
  type ProcessStatus,
  type ProcessUpdateResult,
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
  nextWatchIndex: number;
}

interface ProcessManagerOptions {
  getConfiguredShellPath?: () => string | undefined;
}

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private counter = 0;
  private logDir: string;
  private events = new EventEmitter();
  private watcher: ReturnType<typeof setInterval> | null = null;
  private getConfiguredShellPath: () => string | undefined;

  private lastOutputEmitAt: Map<string, number> = new Map();
  private pendingOutputEmit: Map<string, NodeJS.Timeout> = new Map();

  constructor(options?: ProcessManagerOptions) {
    this.logDir = mkdtempSync(join(tmpdir(), "pi-processes-"));
    this.getConfiguredShellPath =
      options?.getConfiguredShellPath ?? (() => undefined);
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
    }

    this.ensureWatcherRunning();
    this.stopWatcherIfIdle();
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
      if (alive) continue;

      if (!managed.endTime) {
        managed.endTime = Date.now();
      }

      this.flushPendingOutputChanged(managed.id);
      this.flushPendingLines(managed);

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

  start(
    name: string,
    command: string,
    cwd: string,
    options?: StartOptions,
  ): ProcessInfo {
    const resolvedWatches = this.resolveLogWatches(options?.logWatches, 0);
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
      nextWatchIndex: resolvedWatches.length,
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
      if (managed.endTime) return;

      managed.exitCode = code;
      managed.endTime = Date.now();
      managed.success = code === 0;

      this.flushPendingOutputChanged(id);
      this.flushPendingLines(managed);

      if (signal) {
        this.transition(managed, "killed");
      } else {
        this.transition(managed, "exited");
      }
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

  update(id: string, patch: ProcessMetadataUpdate): ProcessUpdateResult {
    const managed = this.processes.get(id);
    if (!managed) {
      return {
        ok: false,
        reason: "not_found",
        message: `Process not found: ${id}`,
      };
    }

    let replayMatches: LogWatchReplayMatch[] = [];
    const nextName = patch.name?.trim();
    const shouldEmitChange =
      patch.name !== undefined ||
      patch.alertOnSuccess !== undefined ||
      patch.alertOnFailure !== undefined ||
      patch.alertOnKill !== undefined ||
      (patch.logWatchUpdate !== undefined &&
        patch.logWatchUpdate.mode !== "list");

    try {
      if (patch.name !== undefined && !nextName) {
        throw new Error("name must be a non-empty string");
      }

      if (patch.logWatchUpdate) {
        replayMatches = this.applyLogWatchUpdate(managed, patch.logWatchUpdate);
      }

      if (nextName !== undefined) managed.name = nextName;
      if (patch.alertOnSuccess !== undefined) {
        managed.alertOnSuccess = patch.alertOnSuccess;
      }
      if (patch.alertOnFailure !== undefined) {
        managed.alertOnFailure = patch.alertOnFailure;
      }
      if (patch.alertOnKill !== undefined) {
        managed.alertOnKill = patch.alertOnKill;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        reason: "invalid",
        message,
        info: this.toProcessInfo(managed),
        watches: this.logWatchInfo(managed.watches),
      };
    }

    if (shouldEmitChange) this.emit({ type: "processes_changed" });

    return {
      ok: true,
      info: this.toProcessInfo(managed),
      watches: this.logWatchInfo(managed.watches),
      replayMatches,
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
          combinedFile: "",
          watchCount: 0,
          activeWatchCount: 0,
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
      if (err.code !== "EPERM") {
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

  private applyLogWatchUpdate(
    managed: ManagedProcess,
    update: LogWatchUpdate,
  ): LogWatchReplayMatch[] {
    switch (update.mode) {
      case "list":
        return [];
      case "clear":
        managed.watches = [];
        return [];
      case "remove": {
        const indexes = this.normalizeWatchIndexes(update.watchIndexes);
        const remove = new Set(indexes);
        managed.watches = managed.watches.filter(
          (watch) => !remove.has(watch.index),
        );
        return [];
      }
      case "append": {
        if (!update.watches || update.watches.length === 0) {
          throw new Error("logWatches is required for append");
        }
        const replayOptions = this.resolveReplayOptions(update);
        const watches = this.resolveLogWatches(
          update.watches,
          managed.nextWatchIndex,
        );
        managed.nextWatchIndex += watches.length;
        managed.watches = [...managed.watches, ...watches];
        return this.replayWatches(managed, watches, replayOptions);
      }
      case "replace": {
        if (!update.watches || update.watches.length === 0) {
          throw new Error("logWatches is required for replace");
        }
        const replayOptions = this.resolveReplayOptions(update);
        const watches = this.resolveLogWatches(
          update.watches,
          managed.nextWatchIndex,
        );
        managed.nextWatchIndex += watches.length;
        managed.watches = watches;
        return this.replayWatches(managed, watches, replayOptions);
      }
      default:
        throw new Error(
          `Unsupported logWatchUpdate.mode: ${String(update.mode)}`,
        );
    }
  }

  private normalizeWatchIndexes(indexes: number[] | undefined): number[] {
    if (!indexes) throw new Error("watchIndexes is required for remove");
    if (!Array.isArray(indexes))
      throw new Error("watchIndexes must be an array");
    return indexes.map((index, offset) => {
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(
          `watchIndexes[${offset}] must be a non-negative integer`,
        );
      }
      return index;
    });
  }

  private resolveReplayOptions(update: LogWatchUpdate): {
    tailLines: number;
    maxReplayMatches: number;
  } {
    return {
      tailLines: this.normalizeNonNegativeInteger(
        update.replayTailLines,
        0,
        10000,
        "replayTailLines",
      ),
      maxReplayMatches: this.normalizeNonNegativeInteger(
        update.maxReplayMatches,
        20,
        200,
        "maxReplayMatches",
      ),
    };
  }

  private replayWatches(
    managed: ManagedProcess,
    watches: ResolvedWatch[],
    options: { tailLines: number; maxReplayMatches: number },
  ): LogWatchReplayMatch[] {
    const { tailLines, maxReplayMatches } = options;
    if (tailLines === 0 || watches.length === 0 || maxReplayMatches === 0) {
      return [];
    }

    const matches: LogWatchReplayMatch[] = [];
    const replay = (source: "stdout" | "stderr", lines: string[]) => {
      for (const line of lines) {
        for (const watch of watches) {
          if (!watch.repeat && watch.fired) continue;
          if (watch.stream !== "both" && watch.stream !== source) continue;
          if (!watch.regex.test(line)) continue;

          matches.push({
            watchIndex: watch.index,
            pattern: watch.pattern,
            source,
            line,
          });
          if (!watch.repeat) watch.fired = true;
          if (matches.length >= maxReplayMatches) return;
        }
      }
    };

    replay("stdout", this.readTailLines(managed.stdoutFile, tailLines));
    if (matches.length < maxReplayMatches) {
      replay("stderr", this.readTailLines(managed.stderrFile, tailLines));
    }
    return matches;
  }

  private normalizeNonNegativeInteger(
    value: number | undefined,
    fallback: number,
    max: number,
    name: string,
  ): number {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
    if (value > max) {
      throw new Error(`${name} must be <= ${max}`);
    }
    return value;
  }

  private logWatchInfo(watches: ResolvedWatch[]): LogWatchInfo[] {
    return watches.map((watch) => ({
      index: watch.index,
      pattern: watch.pattern,
      stream: watch.stream,
      repeat: watch.repeat,
      fired: watch.fired,
    }));
  }

  private activeWatchCount(watches: ResolvedWatch[]): number {
    return watches.filter((watch) => watch.repeat || !watch.fired).length;
  }

  private resolveLogWatches(
    input: LogWatch[] | undefined,
    startIndex: number,
  ): ResolvedWatch[] {
    if (!input || input.length === 0) return [];

    return input.map((watch, offset) => {
      const index = startIndex + offset;
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

      return {
        index,
        pattern,
        regex,
        stream,
        repeat: watch.repeat ?? false,
        fired: false,
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
            },
          },
        });
      }
    }
  }

  private readTailLines(filePath: string, lines: number): string[] {
    if (lines <= 0) return [];

    let fd: number | null = null;
    try {
      const fileSize = statSync(filePath).size;
      if (fileSize === 0) return [];

      fd = openSync(filePath, "r");
      const chunks: Buffer[] = [];
      const chunkSize = 64 * 1024;
      let position = fileSize;
      let newlineCount = 0;

      while (position > 0 && newlineCount <= lines) {
        const readSize = Math.min(chunkSize, position);
        position -= readSize;

        const buffer = Buffer.allocUnsafe(readSize);
        const bytesRead = readSync(fd, buffer, 0, readSize, position);
        const chunk = buffer.subarray(0, bytesRead);
        chunks.unshift(chunk);

        for (const byte of chunk) {
          if (byte === 10) newlineCount++;
        }
      }

      const content = Buffer.concat(chunks).toString("utf-8");
      const allLines = content.split(/\r?\n/);
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      return allLines.slice(-lines);
    } catch {
      return [];
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          // Ignore close errors for best-effort log inspection.
        }
      }
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
      combinedFile: managed.combinedFile,
      watchCount: managed.watches.length,
      activeWatchCount: LIVE_STATUSES.has(managed.status)
        ? this.activeWatchCount(managed.watches)
        : 0,
      alertOnSuccess: managed.alertOnSuccess,
      alertOnFailure: managed.alertOnFailure,
      alertOnKill: managed.alertOnKill,
    };
  }
}

export type {
  ProcessInfo,
  ProcessStatus,
  ManagerEvent,
  KillResult,
  WriteResult,
};
