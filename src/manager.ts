import { type ChildProcess, spawn } from "node:child_process";
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

import {
  type KillResult,
  LIVE_STATUSES,
  type ManagerEvent,
  type ProcessInfo,
  type ProcessStatus,
  type StartOptions,
} from "./constants";
import { isProcessGroupAlive, killProcessGroup } from "./utils";

interface ManagedProcess extends ProcessInfo {
  process: ChildProcess;
  lastSignalSent: NodeJS.Signals | null;
  combinedFile: string;
}

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private counter = 0;
  private logDir: string;
  private events = new EventEmitter();
  private watcher: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.logDir = join(tmpdir(), `pi-processes-${Date.now()}`);
    mkdirSync(this.logDir, { recursive: true });
  }

  onEvent(listener: (event: ManagerEvent) => void): () => void {
    this.events.on("event", listener);
    return () => this.events.off("event", listener);
  }

  private emit(event: ManagerEvent): void {
    this.events.emit("event", event);
  }

  private transition(managed: ManagedProcess, next: ProcessStatus): void {
    if (managed.status === next) return;
    const prev = managed.status;
    managed.status = next;

    this.emit({
      type: "process_status_changed",
      info: this.toProcessInfo(managed),
      prev,
    });

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
    const id = `proc_${++this.counter}`;
    const stdoutFile = join(this.logDir, `${id}-stdout.log`);
    const stderrFile = join(this.logDir, `${id}-stderr.log`);
    const combinedFile = join(this.logDir, `${id}-combined.log`);

    appendFileSync(stdoutFile, "");
    appendFileSync(stderrFile, "");
    appendFileSync(combinedFile, "");

    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

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
      lastSignalSent: null,
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
        const lines = data.toString().split("\n");
        // The last element after split is either empty (if data ended with \n)
        // or a partial line. We write all parts with the prefix and newline.
        const tagged = lines
          .map((line, i) =>
            i < lines.length - 1 ? `1:${line}\n` : line ? `1:${line}\n` : "",
          )
          .join("");
        if (tagged) appendFileSync(combinedFile, tagged);
      } catch {
        // Ignore
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      try {
        appendFileSync(stderrFile, data);
        const lines = data.toString().split("\n");
        const tagged = lines
          .map((line, i) =>
            i < lines.length - 1 ? `2:${line}\n` : line ? `2:${line}\n` : "",
          )
          .join("");
        if (tagged) appendFileSync(combinedFile, tagged);
      } catch {
        // Ignore
      }
    });

    child.on("close", (code, signal) => {
      if (managed.endTime) return;

      managed.exitCode = code;
      managed.endTime = Date.now();
      managed.success = code === 0;

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

  find(query: string): ProcessInfo | null {
    const byId = this.processes.get(query);
    if (byId) return this.toProcessInfo(byId);

    const queryLower = query.toLowerCase();
    for (const managed of this.processes.values()) {
      if (managed.name.toLowerCase().includes(queryLower)) {
        return this.toProcessInfo(managed);
      }
      if (managed.command.toLowerCase().includes(queryLower)) {
        return this.toProcessInfo(managed);
      }
    }
    return null;
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

  getLogFiles(id: string): { stdoutFile: string; stderrFile: string } | null {
    const managed = this.processes.get(id);
    if (!managed) return null;
    return {
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
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

    this.transition(managed, "killed");
    return { ok: true, info: this.toProcessInfo(managed) };
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

export type { ProcessInfo, ProcessStatus, ManagerEvent, KillResult };
