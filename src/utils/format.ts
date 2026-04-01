import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ProcessInfo } from "../constants";

export function formatRuntime(
  startTime: number,
  endTime: number | null,
): string {
  const end = endTime ?? Date.now();
  const ms = end - startTime;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function formatStatus(proc: ProcessInfo): string {
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

export function truncateCmd(cmd: string, max = 40): string {
  if (cmd.length <= max) return cmd;
  return `${cmd.slice(0, max - 3)}...`;
}

export function formatTimestamp(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}

export function formatStatusTag(
  process: {
    status: string;
    success: boolean | null;
    exitCode: number | null;
  },
  theme: Theme,
): string {
  switch (process.status) {
    case "running":
      return theme.fg("accent", "running");
    case "terminating":
      return theme.fg("warning", "terminating");
    case "terminate_timeout":
      return theme.fg("error", "terminate_timeout");
    case "killed":
      return theme.fg("warning", "killed");
    case "exited":
      return process.success
        ? theme.fg("success", "exit(0)")
        : theme.fg("error", `exit(${process.exitCode ?? "?"})`);
    default:
      return theme.fg("muted", process.status);
  }
}
