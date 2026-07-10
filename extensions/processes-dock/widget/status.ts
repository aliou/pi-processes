import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { LIVE_STATUSES, type ProcessInfo } from "../../../src/types";
import { statusDot } from "../../shared/ui";

const MAX_PROCESS_NAME = 20;
const DEFAULT_MAX_WIDTH = 200;

function formatProcessName(name: string, theme: Theme): string {
  const trimmed =
    name.length > MAX_PROCESS_NAME
      ? `${name.slice(0, MAX_PROCESS_NAME - 3)}...`
      : name;
  return theme.fg("accent", trimmed);
}

function formatProcessLabel(process: ProcessInfo, theme: Theme): string {
  const name = formatProcessName(process.name, theme);
  const dot = statusDot(process, true, theme);

  switch (process.status) {
    case "running":
      return `${dot} ${name} ${theme.fg("dim", "running")}`;
    case "terminating":
      return `${dot} ${name} ${theme.fg("dim", "stopping")}`;
    case "terminate_timeout":
      return `${dot} ${name} ${theme.fg("error", "unresponsive")}`;
    case "killed":
      return `${dot} ${name} ${theme.fg("dim", "killed")}`;
    case "exited":
      if (process.success) {
        return `${dot} ${name} ${theme.fg("success", "done")}`;
      }
      return `${dot} ${name} ${theme.fg("error", `exit(${process.exitCode ?? "?"})`)}`;
    default:
      return `${dot} ${name} ${theme.fg("dim", process.status)}`;
  }
}

function sortForStatusLine(processes: ProcessInfo[]): ProcessInfo[] {
  const aliveish = processes.filter((process) =>
    LIVE_STATUSES.has(process.status),
  );
  const finished = processes.filter(
    (process) => !LIVE_STATUSES.has(process.status),
  );
  finished.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
  return [...aliveish, ...finished];
}

/**
 * Render the single-line status widget shown below the editor.
 *
 * Lists managed processes (dot + name + state), fit to width with a
 * "+N more" overflow marker. Returns an empty array when there are no
 * processes so the caller can clear the widget.
 */
export function renderStatusWidget(
  processes: ProcessInfo[],
  theme: Theme,
  maxWidth: number = DEFAULT_MAX_WIDTH,
): string[] {
  if (processes.length === 0) return [];

  const ordered = sortForStatusLine(processes);

  const prefix = theme.fg("dim", "processes: ");
  const prefixLen = visibleWidth(prefix);
  const separator = theme.fg("dim", " | ");
  const separatorLen = visibleWidth(separator);

  const parts: string[] = [];
  let currentLen = prefixLen;
  let includedCount = 0;

  for (const process of ordered) {
    const formatted = formatProcessLabel(process, theme);
    const formattedLen = visibleWidth(formatted);
    const remaining = ordered.length - includedCount - 1;
    const needed =
      includedCount > 0 ? separatorLen + formattedLen : formattedLen;

    const reservedForSuffix =
      remaining > 0 ? separatorLen + visibleWidth(`+${remaining} more`) : 0;

    if (
      currentLen + needed + reservedForSuffix > maxWidth &&
      includedCount > 0
    ) {
      const hiddenCount = ordered.length - includedCount;
      if (hiddenCount > 0) {
        parts.push(theme.fg("dim", `+${hiddenCount} more`));
      }
      break;
    }

    parts.push(formatted);
    currentLen += needed;
    includedCount++;
  }

  // Width too small for even one entry: show the first process anyway.
  if (includedCount === 0) {
    parts.push(formatProcessLabel(ordered[0] as ProcessInfo, theme));
  }

  if (parts.length === 0) return [];

  const line = prefix + parts.join(separator);
  return [
    visibleWidth(line) > maxWidth ? truncateToWidth(line, maxWidth) : line,
  ];
}
