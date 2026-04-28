import type { ProcessInfo, ProcessStatus } from "../constants";
import { formatMonitorSummary } from "../utils";

export function statusLabel(proc: ProcessInfo): string {
  let status: string;
  switch (proc.status) {
    case "running":
      status = "running";
      break;
    case "terminating":
      status = "terminating";
      break;
    case "terminate_timeout":
      status = "terminate_timeout";
      break;
    case "killed":
      status = "killed";
      break;
    case "exited":
      status = proc.success ? "exit(0)" : `exit(${proc.exitCode ?? "?"})`;
      break;
    default:
      status = proc.status;
      break;
  }

  const monitor = formatMonitorSummary(proc);
  return monitor ? `${status} ${monitor}` : status;
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
