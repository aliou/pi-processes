import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ProcessInfo, ProcessStatus } from "../../../src/types";
import { formatStatus } from "../../../src/utils/format";

export function statusLabel(process: ProcessInfo): string {
  return formatStatus(process);
}

export function statusIcon(
  status: ProcessStatus,
  success: boolean | null,
): string {
  if (status === "running") return "●";
  if (status === "terminating") return "●";
  if (status === "terminate_timeout") return "✗";
  if (status === "killed") return "✗";
  if (success) return "✓";
  return "✗";
}

export function formatStatusTag(process: ProcessInfo, theme: Theme): string {
  const label = statusLabel(process);
  switch (process.status) {
    case "running":
      return theme.fg("accent", label);
    case "terminating":
    case "terminate_timeout":
      return theme.fg("warning", label);
    case "exited":
      return process.success
        ? theme.fg("success", label)
        : theme.fg("error", label);
    case "killed":
      return theme.fg("muted", label);
    default:
      return label;
  }
}
