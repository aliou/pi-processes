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

type SummaryKind = "done" | "failed" | "killed";

/**
 * The synthetic ProcessInfo makes statusDot draw the same glyph
 * (`✓` / `!` / `■`) the individual rows use.
 */
const SUMMARY_TOKENS: Record<
  SummaryKind,
  { process: ProcessInfo; label: string }
> = {
  done: {
    process: {
      id: "_summary",
      name: "",
      status: "exited",
      success: true,
      exitCode: 0,
    } as ProcessInfo,
    label: "done",
  },
  failed: {
    process: {
      id: "_summary",
      name: "",
      status: "exited",
      success: false,
      exitCode: 1,
    } as ProcessInfo,
    label: "failed",
  },
  killed: {
    process: {
      id: "_summary",
      name: "",
      status: "killed",
      success: false,
      exitCode: null,
    } as ProcessInfo,
    label: "killed",
  },
};

function formatSummary(kind: SummaryKind, count: number, theme: Theme): string {
  const { process, label } = SUMMARY_TOKENS[kind];
  return `${statusDot(process, false, theme)} ${theme.fg("dim", `${count} ${label}`)}`;
}

/**
 * Partition processes into:
 * - individual: live processes, plus failed/killed ids in `pendingTerminalIds`
 *   (a fresh failure stays visible by name until the next process starts)
 * - failed: folded failures (collapsed into one `! N failed` token)
 * - killed: folded kills (collapsed into one `■ N killed` token)
 * - exitedSuccess: clean exits (collapsed into one `✓ N done` token)
 */
function partitionForStatusLine(
  processes: ProcessInfo[],
  pendingTerminalIds: ReadonlySet<string>,
): {
  individual: ProcessInfo[];
  failed: ProcessInfo[];
  killed: ProcessInfo[];
  exitedSuccess: ProcessInfo[];
} {
  const individual: ProcessInfo[] = [];
  const failed: ProcessInfo[] = [];
  const killed: ProcessInfo[] = [];
  const exitedSuccess: ProcessInfo[] = [];

  // Live first, then failed/killed, ordered naturally.
  const live = processes.filter((p) => LIVE_STATUSES.has(p.status));
  const finished = processes.filter((p) => !LIVE_STATUSES.has(p.status));
  finished.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));

  for (const p of [...live, ...finished]) {
    if (LIVE_STATUSES.has(p.status) || pendingTerminalIds.has(p.id)) {
      individual.push(p);
      continue;
    }
    if (p.status === "killed") {
      killed.push(p);
      continue;
    }
    if (p.status === "exited" && p.success) {
      exitedSuccess.push(p);
      continue;
    }
    failed.push(p);
  }

  return { individual, failed, killed, exitedSuccess };
}

/**
 * Render the single-line status widget shown below the editor.
 *
 * Lists managed processes (dot + name). Live processes are shown
 * individually; failed and killed processes stay individual while their id
 * is in `pendingTerminalIds` and fold into `! N failed` / `■ N killed`
 * summaries afterwards; successfully-exited processes collapse into a single
 * `✓ N done` summary. The dot glyph encodes status; the name is colored by
 * status tone. Returns an empty array when there are no processes so the
 * caller can clear the widget.
 */
export function renderStatusWidget(
  processes: ProcessInfo[],
  theme: Theme,
  maxWidth: number = DEFAULT_MAX_WIDTH,
  pendingTerminalIds: ReadonlySet<string> = new Set(),
): string[] {
  if (processes.length === 0) return [];

  const { individual, failed, killed, exitedSuccess } = partitionForStatusLine(
    processes,
    pendingTerminalIds,
  );

  const prefix = theme.fg("dim", "ps: ");
  const prefixLen = visibleWidth(prefix);
  const separator = theme.fg("dim", "  ");
  const separatorLen = visibleWidth(separator);

  // Build the full ordered list of display tokens: individual processes
  // followed by the failed / killed / done summaries (if any).
  const tokens: string[] = [];
  for (const process of individual) {
    tokens.push(formatProcessLabel(process, theme));
  }
  if (failed.length > 0) {
    tokens.push(formatSummary("failed", failed.length, theme));
  }
  if (killed.length > 0) {
    tokens.push(formatSummary("killed", killed.length, theme));
  }
  if (exitedSuccess.length > 0) {
    tokens.push(formatSummary("done", exitedSuccess.length, theme));
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
