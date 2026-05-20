import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ProcessInfo } from "../constants";

function isLiveStatus(status: string): boolean {
  return (
    status === "running" ||
    status === "terminating" ||
    status === "terminate_timeout"
  );
}

export function formatMonitorSummary(proc: {
  status: string;
  activeWatchCount?: number;
  alertOnSuccess: boolean;
  alertOnFailure: boolean;
  alertOnKill: boolean;
}): string {
  if (!isLiveStatus(proc.status)) return "";

  const parts: string[] = [];
  const activeWatchCount = proc.activeWatchCount ?? 0;
  if (activeWatchCount > 0) parts.push(`watch:${activeWatchCount}`);

  const alerts: string[] = [];
  if (proc.alertOnSuccess) alerts.push("ok");
  if (proc.alertOnFailure) alerts.push("fail");
  if (proc.alertOnKill) alerts.push("kill");
  if (alerts.length > 0) parts.push(`alert:${alerts.join("/")}`);

  return parts.join(" ");
}

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
  return monitor ? `${status}; ${monitor}` : status;
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
    activeWatchCount?: number;
    alertOnSuccess?: boolean;
    alertOnFailure?: boolean;
    alertOnKill?: boolean;
  },
  theme: Theme,
): string {
  let status: string;
  let color: Parameters<Theme["fg"]>[0];
  switch (process.status) {
    case "running":
      status = "running";
      color = "accent";
      break;
    case "terminating":
      status = "terminating";
      color = "warning";
      break;
    case "terminate_timeout":
      status = "terminate_timeout";
      color = "error";
      break;
    case "killed":
      status = "killed";
      color = "warning";
      break;
    case "exited":
      status = process.success ? "exit(0)" : `exit(${process.exitCode ?? "?"})`;
      color = process.success ? "success" : "error";
      break;
    default:
      status = process.status;
      color = "muted";
      break;
  }

  const monitor = formatMonitorSummary({
    status: process.status,
    activeWatchCount: process.activeWatchCount ?? 0,
    alertOnSuccess: process.alertOnSuccess ?? false,
    alertOnFailure: process.alertOnFailure ?? false,
    alertOnKill: process.alertOnKill ?? false,
  });
  return monitor
    ? `${theme.fg(color, status)} ${theme.fg("dim", monitor)}`
    : theme.fg(color, status);
}
