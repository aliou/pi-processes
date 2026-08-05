import { Stack } from "@aliou/pi-utils-ui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import type { ProcessInfo } from "../../../src/types";
import { LIVE_STATUSES } from "../../../src/types";
import { renderProcessTab } from "../../process-tabs";
import { sanitizeForDisplay } from "../../shared/display-text";
import { displayTextOf, renderLogLine } from "../../shared/log-line";
import { truncateToWidth } from "../../shared/truncate";
import {
  clampNameColumn,
  LineComponent,
  LinesComponent,
  statusDot,
} from "../../shared/ui";
import type { ProcessLogLine } from "../client";
import type { DockState } from "../widget/types";

export interface ProcessLogEntry {
  processId: string;
  line: ProcessLogLine;
}

export interface LogDockSnapshot {
  processes: ProcessInfo[];
  pinnedProcess: ProcessInfo | null;
  pinnedLines: ProcessLogLine[];
  processLogStream: ProcessLogEntry[];
  previews: Map<string, ProcessLogLine | null>;
  notifyLines: Set<string>;
  notifyCounts: Map<string, number>;
  state: DockState;
}

export function renderCollapsedDockLine(
  content: string,
  width: number,
): string {
  if (width <= 0) return "";

  const line = truncateToWidth(content, width, "", true);
  return `${line}${" ".repeat(Math.max(0, width - visibleWidth(line)))}`;
}

export function renderLogDock(
  snapshot: LogDockSnapshot,
  theme: Theme,
  width: number,
  logRows: number,
): string[] {
  if (snapshot.state.visibility === "closed") return [];
  if (snapshot.processes.length === 0) return [];

  const body =
    snapshot.state.visibility === "expanded"
      ? buildExpandedBody(snapshot, theme, Math.max(1, logRows))
      : buildCollapsedBody(snapshot, theme);

  return renderMinimalBox(
    "Processes",
    body,
    theme,
    width,
    snapshot.state.visibility === "expanded",
  );
}

const SIDE_PADDING = 1;

/**
 * Render the dock as a minimal panel: a top bar with the title (no side
 * padding), an optional full-width rule between the process strip and the
 * logs, and a single space of side padding for the body lines. No bottom
 * border so the dock opens cleanly into the editor below.
 */
function renderMinimalBox(
  title: string,
  body: Component,
  theme: Theme,
  width: number,
  withProcessStrip: boolean,
): string[] {
  const dim = (text: string) => theme.fg("dim", text);
  const lines: string[] = [];

  // Top bar: no side padding, title sits after a small "── " flourish.
  const label = `── ${title} `;
  const labelWidth = visibleWidth(label);
  if (labelWidth >= width) {
    lines.push(dim("─".repeat(Math.max(0, width))));
  } else {
    lines.push(dim(label) + dim("─".repeat(width - labelWidth)));
  }

  const innerWidth = Math.max(0, width - SIDE_PADDING * 2);
  const pad = " ".repeat(SIDE_PADDING);
  const bodyLines = body.render(innerWidth);

  if (!withProcessStrip) {
    // Collapsed mode: body is just log preview lines.
    for (const line of bodyLines) {
      const log = truncateToWidth(line, innerWidth, "", true);
      lines.push(`${pad}${log}${pad}`);
    }
    return lines;
  }

  // Expanded mode: first body line is the process strip, the rest are logs.
  if (bodyLines.length > 0) {
    const strip = truncateToWidth(bodyLines[0], innerWidth, "", true);
    lines.push(`${pad}${strip}${pad}`);
  }

  if (bodyLines.length > 1) {
    lines.push(dim("─".repeat(Math.max(0, width))));
    for (let i = 1; i < bodyLines.length; i++) {
      const log = truncateToWidth(bodyLines[i], innerWidth, "", true);
      lines.push(`${pad}${log}${pad}`);
    }
  }

  return lines;
}

function buildCollapsedBody(
  snapshot: LogDockSnapshot,
  theme: Theme,
): Component {
  // Collapsed dock is intentionally minimal: just the header and a short
  // log preview. No process strip.
  return new LinesComponent((width) =>
    renderCollapsedLogLines(snapshot, theme, width),
  );
}

function buildExpandedBody(
  snapshot: LogDockSnapshot,
  theme: Theme,
  logRows: number,
): Component {
  const body = new Stack({ gap: 0 });
  body.addChild(
    new LineComponent((width) => renderProcessStrip(snapshot, theme, width)),
  );
  body.addChild(
    new LinesComponent((width) => {
      const contentLines = snapshot.pinnedProcess
        ? renderPinnedLogLines(snapshot, theme, width, logRows)
        : renderAllRunningLogLines(snapshot, theme, width, logRows);
      return Array.from(
        { length: logRows },
        (_, index) => contentLines[index] ?? "",
      );
    }),
  );
  return body;
}

function renderCollapsedLogLines(
  snapshot: LogDockSnapshot,
  theme: Theme,
  width: number,
): string[] {
  const height = 2;
  const lines = snapshot.pinnedProcess
    ? renderCollapsedPinnedLogLines(snapshot, theme, width, height)
    : renderAllRunningLogLines(snapshot, theme, width, height);

  if (lines.length === 0) return ["", ""];
  return Array.from({ length: height }, (_, index) => lines[index] ?? "");
}

function renderCollapsedPinnedLogLines(
  snapshot: LogDockSnapshot,
  theme: Theme,
  width: number,
  height: number,
): string[] {
  if (snapshot.pinnedLines.length > 0) {
    return renderLogLines(snapshot.pinnedLines, snapshot, theme, width, height);
  }

  const processId = snapshot.pinnedProcess?.id;
  const lines = processId
    ? snapshot.processLogStream
        .filter((entry) => entry.processId === processId)
        .map((entry) => entry.line)
    : [];
  return renderLogLines(lines, snapshot, theme, width, height);
}

function renderProcessStrip(
  snapshot: LogDockSnapshot,
  theme: Theme,
  width: number,
): string {
  const liveOrVisible = snapshot.processes.filter(
    (process) =>
      LIVE_STATUSES.has(process.status) ||
      snapshot.pinnedProcess?.id === process.id,
  );
  const finished = snapshot.processes.filter(
    (process) =>
      !LIVE_STATUSES.has(process.status) &&
      snapshot.pinnedProcess?.id !== process.id,
  );

  // Show live and failed/killed processes individually; collapse only
  // exited-success into a single summary token.
  const exitedSuccess: ProcessInfo[] = [];
  const shown: ProcessInfo[] = [];
  for (const process of finished) {
    if (process.status === "exited" && process.success) {
      exitedSuccess.push(process);
    } else {
      shown.push(process);
    }
  }

  const ordered = [...liveOrVisible, ...shown];
  const parts = ordered.map((process) =>
    renderProcessToken(process, snapshot, theme),
  );
  if (exitedSuccess.length > 0) {
    const summary = {
      id: "_summary",
      name: "",
      status: "exited",
      success: true,
      exitCode: 0,
    } as ProcessInfo;
    parts.push(
      `${statusDot(summary, false, theme)} ${theme.fg("dim", `${exitedSuccess.length} done`)}`,
    );
  }

  return truncateToWidth(
    parts.join(" ") || theme.fg("dim", "No running processes"),
    width,
  );
}

function renderPinnedLogLines(
  snapshot: LogDockSnapshot,
  theme: Theme,
  width: number,
  height: number,
): string[] {
  if (snapshot.pinnedLines.length === 0) {
    return centerLine(theme.fg("muted", "No output yet"), width, height);
  }

  return renderLogLines(snapshot.pinnedLines, snapshot, theme, width, height);
}

function renderAllRunningLogLines(
  snapshot: LogDockSnapshot,
  theme: Theme,
  width: number,
  height: number,
): string[] {
  const byId = new Map(
    snapshot.processes.map((process) => [process.id, process]),
  );
  const stream = snapshot.processLogStream.filter(({ processId }) => {
    const process = byId.get(processId);
    return process ? LIVE_STATUSES.has(process.status) : false;
  });

  if (stream.length === 0) {
    return centerLine(theme.fg("muted", "No output yet"), width, height);
  }

  const activeProcesses = snapshot.processes.filter((process) =>
    LIVE_STATUSES.has(process.status),
  );
  const nameCol = clampNameColumn(activeProcesses);
  const separator = theme.fg("dim", " │ ");

  return stream.slice(-height).map(({ processId, line }) => {
    const process = byId.get(processId);
    const label = theme.fg("dim", padName(process?.name ?? processId, nameCol));
    return renderLogText(line, snapshot, theme, width, `${label}${separator}`);
  });
}

function renderLogLines(
  lines: ProcessLogLine[],
  snapshot: LogDockSnapshot,
  theme: Theme,
  width: number,
  height: number,
): string[] {
  const compacted = compactRepeatedLines(lines);
  return compacted
    .slice(-height)
    .map((line) => renderLogText(line, snapshot, theme, width));
}

function renderLogText(
  line: ProcessLogLine,
  snapshot: LogDockSnapshot,
  theme: Theme,
  width: number,
  prefix = "",
): string {
  const notified =
    snapshot.notifyLines.has(line.text) ||
    snapshot.notifyLines.has(displayTextOf(line));
  return renderLogLine(line, {
    theme,
    width,
    prefix,
    emphasis: notified ? "notify" : "none",
  });
}

function renderProcessToken(
  process: ProcessInfo,
  snapshot: LogDockSnapshot,
  theme: Theme,
): string {
  const tab = renderProcessTab(
    process,
    snapshot.pinnedProcess?.id === process.id,
    theme,
  );
  const badge = snapshot.notifyCounts.get(process.id)
    ? theme.fg("warning", `▸${snapshot.notifyCounts.get(process.id)}`)
    : "";
  return badge ? `${tab}${badge}` : tab;
}

function compactRepeatedLines(lines: ProcessLogLine[]): ProcessLogLine[] {
  const result: ProcessLogLine[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let repeats = 1;
    while (
      index + repeats < lines.length &&
      lines[index + repeats]?.type === line.type &&
      lines[index + repeats]?.text === line.text
    ) {
      repeats++;
    }
    result.push(line);
    if (repeats >= 3) {
      result.push({ type: line.type, text: `… repeated ${repeats - 1} times` });
    } else {
      for (let repeat = 1; repeat < repeats; repeat++) result.push(line);
    }
    index += repeats - 1;
  }
  return result;
}

function centerLine(content: string, width: number, height: number): string[] {
  const lines = Array.from({ length: height }, () => "");
  const row = Math.max(0, Math.floor((height - 1) / 2));
  const leftPad = Math.max(0, Math.floor((width - visibleWidth(content)) / 2));
  lines[row] = truncateToWidth(`${" ".repeat(leftPad)}${content}`, width);
  return lines;
}

function padName(value: string, width: number): string {
  const name = truncateToWidth(sanitizeForDisplay(value), width, "", true);
  return `${name}${" ".repeat(Math.max(0, width - visibleWidth(name)))}`;
}
