// Custom message type for process update notifications
export const MESSAGE_TYPE_PROCESS_UPDATE = "ad-process:update";

export type ProcessAction =
  | "start"
  | "list"
  | "output"
  | "logs"
  | "kill"
  | "clear"
  | "write"
  | "debug_preview";

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

export interface LogWatch {
  pattern: string;
  stream?: LogWatchStream;
  repeat?: boolean;
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
    stream: LogWatchStream;
    repeat: boolean;
  };
}

export type ManagerEvent =
  | { type: "process_started"; info: ProcessInfo }
  | { type: "process_ended"; info: ProcessInfo }
  | { type: "process_output_changed"; id: string }
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

export interface StartOptions {
  alertOnSuccess?: boolean;
  alertOnFailure?: boolean;
  alertOnKill?: boolean;
  logWatches?: LogWatch[];
}

export interface ProcessesDetails {
  action: ProcessAction;
  success: boolean;
  message: string;
  process?: ProcessInfo;
  processes?: ProcessInfo[];
  output?: { stdout: string[]; stderr: string[]; status: string };
  logFiles?: { stdoutFile: string; stderrFile: string };
  cleared?: number;
}

export interface ExecuteResult {
  content: Array<{ type: "text"; text: string }>;
  details: ProcessesDetails;
}
