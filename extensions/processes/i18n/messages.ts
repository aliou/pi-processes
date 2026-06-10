export type MessageKey =
  | "process.list.empty"
  | "process.list.summary"
  | "process.stop.not_found"
  | "process.stop.timeout"
  | "process.status.running"
  | "process.status.terminating"
  | "process.status.terminate_timeout"
  | "process.status.exited"
  | "process.status.killed"
  | "process.status.failed"
  | "process.blocker.background_command";

export const ENGLISH: Record<MessageKey, string> = {
  "process.list.empty": "No running processes",
  "process.list.summary": "{count} process{count_plural}",
  "process.stop.not_found": "Process not found: {id}",
  "process.stop.timeout": "Process kill timed out: {id}",
  "process.status.running": "running",
  "process.status.terminating": "terminating",
  "process.status.terminate_timeout": "terminate timeout",
  "process.status.exited": "exited ({exitCode})",
  "process.status.killed": "killed",
  "process.status.failed": "failed ({errorMessage})",
  "process.blocker.background_command":
    "Shell background patterns (&, nohup, disown, setsid) are not allowed. Use the process tool to manage background commands.",
};
