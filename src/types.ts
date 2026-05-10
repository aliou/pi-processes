export type ProcessStatus =
  | "running"
  | "terminating"
  | "terminate_timeout"
  | "exited"
  | "killed";

export const LIVE_STATUSES: ReadonlySet<ProcessStatus> = new Set([
  "running",
  "terminating",
  "terminate_timeout",
]);

export type LogWatchStream = "stdout" | "stderr" | "both";
export type LogWatchMode = "literal" | "regex";

export interface LogWatch {
  pattern: string;
  mode?: LogWatchMode;
  stream?: LogWatchStream;
  repeat?: boolean;
}

export interface StartOptions {
  alertOnSuccess?: boolean; // default false
  alertOnFailure?: boolean; // default true
  alertOnKill?: boolean; // default false
  logWatches?: LogWatch[];
}

export interface ProcessInfo {
  id: string;
  name: string;
  pid: number; // On Unix, this is also the PGID (process group leader)
  command: string;
  cwd: string;
  startTime: number;
  endTime: number | null;
  status: ProcessStatus;
  exitCode: number | null;
  success: boolean | null; // null if running, true if exit code 0, false otherwise
  stdoutFile: string;
  stderrFile: string;
  alertOnSuccess: boolean;
  alertOnFailure: boolean;
  alertOnKill: boolean;
}

export interface LogWatchMatchEvent {
  processId: string;
  processName: string;
  processCommand: string;
  source: "stdout" | "stderr";
  line: string;
  watch: {
    index: number;
    pattern: string;
    mode: LogWatchMode;
    stream: LogWatchStream;
    repeat: boolean;
  };
}

export type ManagerEvent =
  | { type: "process_started"; info: ProcessInfo }
  | { type: "process_ended"; info: ProcessInfo }
  | {
      type: "process_output_changed";
      id: string;
      appendedText?: Array<{ type: "stdout" | "stderr"; text: string }>;
    }
  | { type: "process_watch_matched"; match: LogWatchMatchEvent }
  | { type: "processes_changed" };

export type KillResult =
  | { ok: true; info: ProcessInfo }
  | { ok: false; info: ProcessInfo; reason: "not_found" | "timeout" | "error" };

export type WriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "process_exited" | "stdin_closed" | "write_error";
    };
