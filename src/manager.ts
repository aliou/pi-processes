import { type ChildProcess, spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ProcessInfo {
  id: string;
  name: string; // Friendly name for display
  pid: number;
  command: string;
  cwd: string;
  startTime: number;
  endTime: number | null;
  status: "running" | "exited" | "killed";
  exitCode: number | null;
  success: boolean | null; // null if running, true if exit code 0, false otherwise
  stdoutFile: string;
  stderrFile: string;
}

interface ManagedProcess extends ProcessInfo {
  process: ChildProcess;
}

// Generate a friendly name from command
function inferName(command: string): string {
  const cmd = command.toLowerCase();

  // Dev servers
  if (cmd.includes("dev") && cmd.includes("backend")) return "backend-dev";
  if (cmd.includes("dev") && cmd.includes("frontend")) return "frontend-dev";
  if (cmd.includes("dev") && cmd.includes("api")) return "api-dev";
  if (
    cmd.includes("pnpm dev") ||
    cmd.includes("npm run dev") ||
    cmd.includes("yarn dev")
  )
    return "dev-server";
  if (cmd.includes("vite")) return "vite-dev";
  if (cmd.includes("next dev")) return "next-dev";

  // Build
  if (cmd.includes("build")) return "build";
  if (cmd.includes("compile")) return "compile";

  // Tests
  if (cmd.includes("test") || cmd.includes("jest") || cmd.includes("vitest"))
    return "tests";

  // Watch
  if (cmd.includes("watch")) return "watcher";

  // Logs
  if (cmd.includes("tail")) return "log-tail";

  // Docker
  if (cmd.includes("docker-compose") || cmd.includes("docker compose"))
    return "docker";

  // Database
  if (
    cmd.includes("postgres") ||
    cmd.includes("mysql") ||
    cmd.includes("mongo")
  )
    return "database";

  // Extract first meaningful word
  const words = command.split(/\s+/);
  const firstWord = words[0]
    .replace(/^\.\//, "")
    .replace(/\.(sh|js|ts|py)$/, "");
  return firstWord.slice(0, 20);
}

export class ProcessManager {
  private processes: Map<string, ManagedProcess> = new Map();
  private counter = 0;
  private logDir: string;
  onProcessEnd?: (info: ProcessInfo) => void;

  constructor() {
    this.logDir = join(tmpdir(), `pi-processes-${Date.now()}`);
    mkdirSync(this.logDir, { recursive: true });
  }

  private emitProcessEnd(info: ProcessInfo): void {
    this.onProcessEnd?.(info);
  }

  start(command: string, cwd: string, name?: string): ProcessInfo {
    const id = `proc_${++this.counter}`;
    const friendlyName = name || inferName(command);
    const stdoutFile = join(this.logDir, `${id}-stdout.log`);
    const stderrFile = join(this.logDir, `${id}-stderr.log`);

    appendFileSync(stdoutFile, "");
    appendFileSync(stderrFile, "");

    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const managed: ManagedProcess = {
      id,
      name: friendlyName,
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
      process: child,
    };

    child.stdout?.on("data", (data: Buffer) => {
      try {
        appendFileSync(stdoutFile, data);
      } catch {
        // Ignore write errors
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      try {
        appendFileSync(stderrFile, data);
      } catch {
        // Ignore write errors
      }
    });

    child.on("close", (code, signal) => {
      managed.exitCode = code;
      managed.endTime = Date.now();
      managed.success = code === 0;
      if (managed.status === "running") {
        managed.status = signal ? "killed" : "exited";
      }
      this.emitProcessEnd(this.toProcessInfo(managed));
    });

    child.on("error", (err) => {
      try {
        appendFileSync(stderrFile, `Process error: ${err.message}\n`);
      } catch {
        // Ignore
      }
      managed.status = "exited";
      managed.exitCode = -1;
      managed.success = false;
      managed.endTime = Date.now();
      this.emitProcessEnd(this.toProcessInfo(managed));
    });

    this.processes.set(id, managed);

    return this.toProcessInfo(managed);
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((p) =>
      this.toProcessInfo(p),
    );
  }

  get(id: string): ProcessInfo | null {
    const managed = this.processes.get(id);
    return managed ? this.toProcessInfo(managed) : null;
  }

  // Find by ID or name (partial match)
  find(query: string): ProcessInfo | null {
    // Exact ID match first
    const byId = this.processes.get(query);
    if (byId) return this.toProcessInfo(byId);

    // Search by name (case insensitive, partial match)
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

  kill(id: string): boolean {
    const managed = this.processes.get(id);
    if (!managed) return false;

    if (managed.status !== "running") {
      return true;
    }

    managed.status = "killed";
    managed.endTime = Date.now();
    managed.success = false;

    try {
      managed.process.kill("SIGTERM");

      setTimeout(() => {
        try {
          if (!managed.process.killed) {
            managed.process.kill("SIGKILL");
          }
        } catch {
          // Process may already be dead
        }
      }, 3000);

      return true;
    } catch {
      return false;
    }
  }

  // Clear finished processes (not running)
  clearFinished(): number {
    let cleared = 0;
    for (const [id, managed] of this.processes) {
      if (managed.status !== "running") {
        // Clean up log files
        try {
          rmSync(managed.stdoutFile, { force: true });
          rmSync(managed.stderrFile, { force: true });
        } catch {
          // Ignore
        }
        this.processes.delete(id);
        cleared++;
      }
    }
    return cleared;
  }

  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id);
    }
  }

  cleanup(): void {
    this.killAll();
    try {
      rmSync(this.logDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
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
    };
  }
}
