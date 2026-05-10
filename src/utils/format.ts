import type { ProcessStatus } from "../types";

/**
 * Format a process runtime as a human-readable string.
 * "3s", "2m 15s", "1h 30m"
 */
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

/**
 * Format a process status as a plain string.
 * "running", "exit(0)", "exit(1)"
 */
export function formatStatus(proc: {
  status: string;
  success: boolean | null;
  exitCode: number | null;
}): string {
  switch (proc.status as ProcessStatus) {
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

/**
 * Truncate a command string to a maximum length.
 */
export function truncateCmd(cmd: string, max = 40): string {
  if (cmd.length <= max) return cmd;
  return `${cmd.slice(0, max - 3)}...`;
}

/**
 * Format a timestamp as an ISO string or "-" if null.
 */
export function formatTimestamp(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
}
