import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProcessLogPaths } from "./internal-types";

export class ProcessLogStore {
  private logDir: string;

  constructor(logDir?: string) {
    this.logDir = logDir ?? join(tmpdir(), `pi-processes-${Date.now()}`);
    mkdirSync(this.logDir, { recursive: true });
  }

  getLogDir(): string {
    return this.logDir;
  }

  createLogs(processId: string): ProcessLogPaths {
    const stdoutFile = join(this.logDir, `${processId}-stdout.log`);
    const stderrFile = join(this.logDir, `${processId}-stderr.log`);
    const combinedFile = join(this.logDir, `${processId}-combined.log`);

    appendFileSync(stdoutFile, "");
    appendFileSync(stderrFile, "");
    appendFileSync(combinedFile, "");

    return { stdoutFile, stderrFile, combinedFile };
  }

  appendStdout(file: string, data: Buffer): void {
    try {
      appendFileSync(file, data);
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  appendStderr(file: string, data: Buffer): void {
    try {
      appendFileSync(file, data);
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  appendCombinedLine(
    file: string,
    source: "stdout" | "stderr",
    line: string,
  ): void {
    const tag = source === "stdout" ? "1" : "2";
    try {
      appendFileSync(file, `${tag}:${line}\n`);
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  appendErrorLine(file: string, message: string): void {
    try {
      appendFileSync(file, `${message}\n`);
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  readTailLines(filePath: string, lines: number): string[] {
    try {
      const content = readFileSync(filePath, "utf-8");
      const allLines = content.split("\n");
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      return allLines.slice(-lines);
    } catch (_error) {
      return [];
    }
  }

  readFullFile(filePath: string): string {
    try {
      return readFileSync(filePath, "utf-8");
    } catch (_error) {
      return "";
    }
  }

  getCombinedOutput(
    combinedFile: string,
    tailLines: number,
  ): Array<{ type: "stdout" | "stderr"; text: string }> {
    const rawLines = this.readTailLines(combinedFile, tailLines);
    return rawLines.map((line) => {
      if (line.startsWith("2:")) {
        return { type: "stderr" as const, text: line.slice(2) };
      }
      return {
        type: "stdout" as const,
        text: line.startsWith("1:") ? line.slice(2) : line,
      };
    });
  }

  getFileSize(paths: ProcessLogPaths): { stdout: number; stderr: number } {
    try {
      return {
        stdout: statSync(paths.stdoutFile).size,
        stderr: statSync(paths.stderrFile).size,
      };
    } catch (_error) {
      return { stdout: 0, stderr: 0 };
    }
  }

  removeLogs(paths: ProcessLogPaths): void {
    try {
      rmSync(paths.stdoutFile, { force: true });
      rmSync(paths.stderrFile, { force: true });
      rmSync(paths.combinedFile, { force: true });
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  cleanup(): void {
    try {
      rmSync(this.logDir, { recursive: true, force: true });
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  [Symbol.dispose](): void {
    this.cleanup();
  }
}
