import type { ProcessInfo, ProcessStatus } from "../constants";

export function statusLabel(proc: ProcessInfo): string {
  switch (proc.status) {
    case "running":
      return "running";
    case "terminating":
      return "terminating";
    case "terminate_timeout":
      return "terminate_timeout";
    case "killed":
      return "killed";
    case "exited":
      return proc.success ? "exit(0)" : `exit(${proc.exitCode ?? "?"})`;
    default:
      return proc.status;
  }
}

export function statusIcon(
  status: ProcessStatus,
  success: boolean | null,
): string {
  switch (status) {
    case "running":
      return "\u25CF"; // filled circle
    case "terminating":
      return "\u25CF"; // filled circle
    case "terminate_timeout":
      return "\u2717"; // x mark
    case "exited":
      return success ? "\u2713" : "\u2717";
    case "killed":
      return "\u2717";
    default:
      return "?";
  }
}
