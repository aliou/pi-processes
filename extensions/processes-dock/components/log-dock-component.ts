import { Stack } from "@aliou/pi-utils-ui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { ProcessInfo } from "../../../src/types";
import { LIVE_STATUSES } from "../../../src/types";
import { stripAnsi } from "../../../src/utils/ansi";
import { renderProcessTab } from "../../process-tabs";
import {
  clampNameColumn,
  LineComponent,
  LinesComponent,
  RuleComponent,
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

  return renderTitledBox("Processes", body, theme, width);
}

/**
 * Render the dock as a top-bordered box with side rails and no bottom
 * border, so it opens into the editor (or the next widget) below — matching
 * the leaner old look without dropping the frame entirely.
 */
function renderTitledBox(
  title: string,
  body: Component,
  theme: Theme,
  width: number,
): string[] {
  const dim = (text: string) => theme.fg("dim", text);
  const innerWidth = Math.max(0, width - 2);

  const lines: string[] = [];

  // Top border with a centered, accent title.
  const styledTitle = theme.fg("accent", theme.bold(` ${title} `));
  const titleWidth = visibleWidth(styledTitle);
  const fill = Math.max(0, width - 1 - titleWidth - 1);
  const leftFill = Math.floor(fill / 2);
  const rightFill = fill - leftFill;
  lines.push(
    dim("╭") +
      dim("─".repeat(leftFill)) +
      styledTitle +
      dim("─".repeat(rightFill)) +
      dim("╮"),
  );

  // Body lines with side rails, no bottom border.
  const bodyLines = body.render(innerWidth);
  for (const line of bodyLines) {
    // truncateToWidth with pad=true truncates AND pads to innerWidth in one call.
    const inner = truncateToWidth(line, innerWidth, "", true);
    lines.push(dim("│") + inner + dim("│"));
  }

  return lines;
}

function buildCollapsedBody(
  snapshot: LogDockSnapshot,
  theme: Theme,
): Component {
  const body = new Stack({ gap: 0 });
  body.addChild(
    new LineComponent((width) => renderProcessStrip(snapshot, theme, width)),
  );
  body.addChild(new RuleComponent(theme));
  body.addChild(
    new LinesComponent((width) =>
      renderCollapsedLogLines(snapshot, theme, width),
    ),
  );
  return body;
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
  body.addChild(new RuleComponent(theme));
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
  const sepLen = visibleWidth(separator);

  return stream.slice(-height).map(({ processId, line }) => {
    const process = byId.get(processId);
    const label = theme.fg("dim", padName(process?.name ?? processId, nameCol));
    const text = renderLogText(
      line,
      snapshot,
      theme,
      Math.max(1, width - nameCol - sepLen),
    );
    return truncateToWidth(`${label}${separator}${text}`, width, "", true);
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
): string {
  const text = truncateToWidth(stripAnsi(line.text), width, "", true);
  if (snapshot.notifyLines.has(line.text) || snapshot.notifyLines.has(text)) {
    return truncateToWidth(theme.underline(text), width);
  }
  if (line.type === "stderr") {
    return truncateToWidth(theme.fg("warning", text), width);
  }
  return truncateToWidth(text, width);
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
  const name = truncateToWidth(value, width, "", true);
  return `${name}${" ".repeat(Math.max(0, width - visibleWidth(name)))}`;
}
