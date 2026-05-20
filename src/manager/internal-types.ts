import type { ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

import type { LogWatchMode, LogWatchStream, ProcessInfo } from "../types";

export interface ProcessLogPaths {
  stdoutFile: string;
  stderrFile: string;
  combinedFile: string;
}

export interface ResolvedWatch {
  index: number;
  pattern: string;
  mode: LogWatchMode;
  regex: RegExp;
  stream: LogWatchStream;
  repeat: boolean;
  fired: boolean;
}

export interface ManagedProcess extends ProcessInfo {
  process: ChildProcess;
  stdin: Writable | null;
  stdinClosed: boolean;
  lastSignalSent: NodeJS.Signals | null;
  combinedFile: string;
  stdoutPendingLine: string;
  stderrPendingLine: string;
  watches: ResolvedWatch[];
  appendedLines: Array<{ type: "stdout" | "stderr"; text: string }>;
}

export function publicProcessInfo(managed: ManagedProcess): ProcessInfo {
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
