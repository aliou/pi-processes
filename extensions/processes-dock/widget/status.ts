import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { LIVE_STATUSES, type ProcessInfo } from "../../../src/types";
import { truncateForDisplay } from "../../shared/display-text";
import { truncateToWidth } from "../../shared/truncate";
import { statusColor, statusDot } from "../../shared/ui";

const MAX_PROCESS_NAME = 20;
const DEFAULT_MAX_WIDTH = 200;

/**
 * Color a process name by its status, matching the dot's color so the dot
 * and the name always agree.
 */
function formatProcessName(process: ProcessInfo, theme: Theme): string {
  return theme.fg(
    statusColor(process),
    truncateForDisplay(process.name, MAX_PROCESS_NAME),
  );
}

/**
 * Render one process as `dot name`. The dot glyph carries the status, so the
 * trailing state word is dropped — it only duplicated what the dot already
 * encodes and wasted columns.
 */
function formatProcessLabel(process: ProcessInfo, theme: Theme): string {
  const dot = statusDot(process, true, theme);
  const name = formatProcessName(process, theme);
  return `${dot} ${name}`;
}

/**
 * Build the summary token for exited-success processes: `✓ N done`.
 * Uses a synthetic exited-success ProcessInfo so statusDot agrees with the
 * rest of the UI.
 */
function formatDoneSummary(count: number, theme: Theme): string {
  const summary: ProcessInfo = {
    id: "_summary",
    name: "",
    status: "exited",
    success: true,
    exitCode: 0,
  } as ProcessInfo;
  return `${statusDot(summary, false, theme)} ${theme.fg("dim", `${count} done`)}`;
}

/**
 * Partition processes into:
 * - individual: live, failed, killed (shown one-by-one)
 * - exitedSuccess: clean exits (collapsed into one `✓ N done` token)
 */
function partitionForStatusLine(processes: ProcessInfo[]): {
  individual: ProcessInfo[];
  exitedSuccess: ProcessInfo[];
} {
  const individual: ProcessInfo[] = [];
  const exitedSuccess: ProcessInfo[] = [];

  // Live first, then failed/killed, ordered naturally.
  const live = processes.filter((p) => LIVE_STATUSES.has(p.status));
  const finished = processes.filter((p) => !LIVE_STATUSES.has(p.status));
  finished.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));

  for (const p of [...live, ...finished]) {
    if (p.status === "exited" && p.success) {
      exitedSuccess.push(p);
    } else {
      individual.push(p);
    }
  }

  return { individual, exitedSuccess };
}

/**
 * Render the single-line status widget shown below the editor.
 *
 * Lists managed processes (dot + name). Live and failed processes are shown
 * individually; successfully-exited processes collapse into a single
 * `✓ N done` summary. The dot glyph encodes status; the name is colored by
 * status tone. Returns an empty array when there are no processes so the
 * caller can clear the widget.
 */
export function renderStatusWidget(
  processes: ProcessInfo[],
  theme: Theme,
  maxWidth: number = DEFAULT_MAX_WIDTH,
): string[] {
  if (processes.length === 0) return [];

  const { individual, exitedSuccess } = partitionForStatusLine(processes);

  const prefix = theme.fg("dim", "ps: ");
  const prefixLen = visibleWidth(prefix);
  const separator = theme.fg("dim", "  ");
  const separatorLen = visibleWidth(separator);

  // Build the full ordered list of display tokens: individual processes
  // followed by the done-summary (if any).
  const tokens: string[] = [];
  for (const process of individual) {
    tokens.push(formatProcessLabel(process, theme));
  }
  if (exitedSuccess.length > 0) {
    tokens.push(formatDoneSummary(exitedSuccess.length, theme));
  }

  // Fit tokens to width, with "+N more" overflow.
  const parts: string[] = [];
  let currentLen = prefixLen;
  let includedCount = 0;

  for (const token of tokens) {
    const tokenLen = visibleWidth(token);
    const remaining = tokens.length - includedCount - 1;
    const needed = includedCount > 0 ? separatorLen + tokenLen : tokenLen;
    const reservedForSuffix =
      remaining > 0 ? separatorLen + visibleWidth(`+${remaining} more`) : 0;

    if (
      currentLen + needed + reservedForSuffix > maxWidth &&
      includedCount > 0
    ) {
      const hiddenCount = tokens.length - includedCount;
      if (hiddenCount > 0) {
        parts.push(theme.fg("dim", `+${hiddenCount} more`));
      }
      break;
    }

    parts.push(token);
    currentLen += needed;
    includedCount++;
  }

  // Width too small for even one entry: show the first token anyway.
  if (includedCount === 0) {
    parts.push(tokens[0] as string);
  }

  if (parts.length === 0) return [];

  const line = prefix + parts.join(separator);
  return [
    visibleWidth(line) > maxWidth ? truncateToWidth(line, maxWidth) : line,
  ];
}
