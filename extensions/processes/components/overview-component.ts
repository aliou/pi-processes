import { Stack } from "@aliou/pi-utils-ui";
import type { EventBus, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Input,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { CHANNELS, type ProcessProtocolConfig } from "../../../src/protocol";
import { LIVE_STATUSES, type ProcessInfo } from "../../../src/types";
import { formatRuntime, truncateCmd } from "../../../src/utils/format";
import { sanitizeForDisplay } from "../../shared/display-text";
import { buildDroppedOutputLine, trimToBudget } from "../../shared/line-buffer";
import { isOutputChangedPayload } from "../../shared/output-payload";
import { LineComponent, LinesComponent, statusColor } from "../../shared/ui";
import {
  type ProcessLogLine,
  requestClear,
  requestCombinedOutput,
  requestKill,
  requestPin,
  requestProcessList,
} from "../client";
import { OverviewPanel } from "./overview-panel";

/** Sort mode for the overview list. */
export type OverviewSort = "status" | "started" | "name";

/** Filter mode for the overview list. */
export type OverviewFilter = "all" | "running" | "finished";

export const OVERVIEW_SORTS: OverviewSort[] = ["status", "started", "name"];
export const OVERVIEW_FILTERS: OverviewFilter[] = [
  "all",
  "running",
  "finished",
];

interface OverviewOptions {
  events: EventBus;
  tui: TUI;
  theme: Theme;
  config: ProcessProtocolConfig;
  initialProcessId?: string;
  onClose: () => void;
}

const MAX_NAME_WIDTH = 16;
const MAX_ID_WIDTH = 10;
const STATUS_WIDTH = 10;
const RUNTIME_WIDTH = 6;
const PREVIEW_LOG_PREFIX = "  ";
const MAX_PREVIEW_LINES = 2000;
const PIN_REPLY_TIMEOUT_MS = 200;
const MIN_OVERVIEW_WIDTH = 40;
const PREVIEW_HEIGHT = 8;

type Mode = "normal" | "filter-typing";

/**
 * Full-screen overview of managed processes. Replaces the editor while open.
 *
 * Uses `pi.events` exclusively (no direct manager access) so it can be split
 * out of the core extension later without changes. Selection survives list
 * refreshes by remembering the selected process id and re-finding its index.
 */
export class OverviewComponent implements Component {
  private processes: ProcessInfo[] = [];
  private selectedIndex = 0;
  private viewOffset = 0;
  private previewLines: ProcessLogLine[] = [];
  private previewOffset = 0;
  private mode: Mode = "normal";
  private readonly filterInput = new Input();
  private sort: OverviewSort = "status";
  private filter: OverviewFilter = "all";
  private quickFilter = "";
  private pinUnavailable = false;
  private pinnedId: string | null = null;
  private hasAnyProcesses = false;
  private totalProcessCount = 0;
  private runningProcessCount = 0;
  private readonly disposers: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly opts: OverviewOptions) {
    this.configureFilterInput();
    this.refresh(opts.initialProcessId);
    this.disposers.push(
      opts.events.on(CHANNELS.CHANGED, () => this.handleChanged()),
    );
    this.disposers.push(
      opts.events.on(CHANNELS.OUTPUT_CHANGED, (payload) =>
        this.handleOutputChanged(payload),
      ),
    );
  }

  render(width: number): string[] {
    const tooSmall = width < MIN_OVERVIEW_WIDTH;
    const panel = new OverviewPanel({
      title: tooSmall ? undefined : "Processes",
      headerLeft: tooSmall ? undefined : this.renderHeaderLeft(),
      headerRight: tooSmall ? undefined : this.renderHeaderRight(),
      body: tooSmall ? this.buildTooSmallBody(width) : this.buildBody(),
      footer: tooSmall ? undefined : this.buildFooter(),
      padding: 0,
      borderStyle: (text) => this.opts.theme.fg("dim", text),
      titleStyle: (text) =>
        this.opts.theme.fg("accent", this.opts.theme.bold(text)),
      metaStyle: (text) => this.opts.theme.fg("dim", text),
    });
    return panel.render(width);
  }

  handleInput(data: string): void {
    if (this.mode === "filter-typing") {
      this.filterInput.handleInput?.(data);
      this.requestRender();
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.close();
      return;
    }
    if (data === "q" || data === "Q") {
      this.close();
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") this.moveSelection(1);
    else if (matchesKey(data, Key.up) || data === "k") this.moveSelection(-1);
    else if (data === "J") this.scrollPreview(1);
    else if (data === "K") this.scrollPreview(-1);
    else if (data === "g") {
      this.previewOffset = 0;
      this.requestRender();
    } else if (data === "G") {
      this.previewOffset = Math.max(0, this.previewLines.length - 1);
      this.requestRender();
    } else if (data === "x") this.killSelected();
    else if (data === "c") this.clearFinished();
    else if (data === "s") this.cycleSort();
    else if (data === "f") this.cycleFilter();
    else if (data === "/") this.startQuickFilter();
    else if (matchesKey(data, Key.enter)) void this.pinSelected();
  }

  invalidate(): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  // --- refresh / state ---

  private refresh(preferredId?: string): void {
    const all = requestProcessList(this.opts.events);
    this.hasAnyProcesses = all.length > 0;
    this.totalProcessCount = all.length;
    this.runningProcessCount = all.filter((process) =>
      LIVE_STATUSES.has(process.status),
    ).length;
    this.processes = this.applyView(all);
    if (this.processes.length === 0) {
      this.selectedIndex = 0;
      this.viewOffset = 0;
      this.previewLines = [];
      this.previewOffset = 0;
      return;
    }
    const keepId = preferredId ?? this.processes[this.selectedIndex]?.id;
    const nextIndex = keepId
      ? this.processes.findIndex((process) => process.id === keepId)
      : -1;
    this.selectedIndex =
      nextIndex >= 0
        ? nextIndex
        : Math.min(this.selectedIndex, this.processes.length - 1);
    this.clampViewOffset();
    this.refreshPreview();
  }

  private handleChanged(): void {
    this.refresh();
    this.requestRender();
  }

  private handleOutputChanged(payload: unknown): void {
    if (!isOutputChangedPayload(payload)) return;
    const selected = this.selectedProcess();
    if (!selected || selected.id !== payload.id) return;
    const appended = [
      ...(payload.droppedLines
        ? [buildDroppedOutputLine(payload.droppedLines)]
        : []),
      ...(payload.appendedText ?? []),
    ];
    if (appended.length === 0) return;

    const follow = this.isFollowingTail();
    const oldLength = this.previewLines.length;
    this.previewLines.push(...appended);
    const combinedLength = this.previewLines.length;
    this.previewLines = trimToBudget(
      this.previewLines,
      MAX_PREVIEW_LINES,
      this.opts.config.output.maxOutputBytes,
    );
    if (follow) {
      this.previewOffset = Math.max(
        0,
        this.previewLines.length - this.previewHeight(),
      );
    } else {
      const removedFromHead = Math.min(
        oldLength,
        combinedLength - this.previewLines.length,
      );
      this.previewOffset = Math.min(
        Math.max(0, this.previewOffset - removedFromHead),
        Math.max(0, this.previewLines.length - 1),
      );
    }
    this.requestRender();
  }

  private applyView(processes: ProcessInfo[]): ProcessInfo[] {
    const filtered = this.filterByMode(processes);
    const quick = this.quickFilter
      ? filtered.filter((process) =>
          process.name.toLowerCase().includes(this.quickFilter.toLowerCase()),
        )
      : filtered;
    return this.sortByMode(quick);
  }

  private filterByMode(processes: ProcessInfo[]): ProcessInfo[] {
    if (this.filter === "running") {
      return processes.filter((process) => LIVE_STATUSES.has(process.status));
    }
    if (this.filter === "finished") {
      return processes.filter((process) => !LIVE_STATUSES.has(process.status));
    }
    return processes;
  }

  private sortByMode(processes: ProcessInfo[]): ProcessInfo[] {
    const copy = [...processes];
    if (this.sort === "status") {
      copy.sort((a, b) => {
        const aLive = LIVE_STATUSES.has(a.status) ? 1 : 0;
        const bLive = LIVE_STATUSES.has(b.status) ? 1 : 0;
        if (bLive !== aLive) return bLive - aLive;
        return b.startTime - a.startTime;
      });
    } else if (this.sort === "started") {
      copy.sort((a, b) => b.startTime - a.startTime);
    } else {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    }
    return copy;
  }

  private selectedProcess(): ProcessInfo | null {
    return this.processes[this.selectedIndex] ?? null;
  }

  private moveSelection(delta: number): void {
    if (this.processes.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex + delta + this.processes.length) %
      this.processes.length;
    this.clampViewOffset();
    this.refreshPreview("newest");
    this.requestRender();
  }

  private clampViewOffset(): void {
    const maxVisible = this.maxVisibleRows();
    if (this.selectedIndex < this.viewOffset) {
      this.viewOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.viewOffset + maxVisible) {
      this.viewOffset = this.selectedIndex - maxVisible + 1;
    }
    this.viewOffset = Math.max(0, this.viewOffset);
  }

  private maxVisibleRows(): number {
    return Math.max(1, this.opts.config.processList.maxVisibleProcesses);
  }

  private scrollPreview(delta: number): void {
    this.previewOffset = Math.max(
      0,
      Math.min(this.previewLines.length - 1, this.previewOffset + delta),
    );
    this.requestRender();
  }

  private refreshPreview(align: "newest" | "keep" = "keep"): void {
    const selected = this.selectedProcess();
    if (!selected) {
      this.previewLines = [];
      this.previewOffset = 0;
      return;
    }

    const available = this.previewHeight();
    // Follow-tail: if the view was already pinned to the newest page (or the
    // caller asked for newest), keep it there after reloading so new output
    // scrolls into view. Otherwise preserve the user's scroll position so a
    // deliberate K-scroll-up is not yanked back by the next output batch.
    const follow = align === "newest" || this.isFollowingTail();

    const lines = requestCombinedOutput(
      this.opts.events,
      selected.id,
      this.opts.config.output.defaultTailLines,
    );
    this.previewLines = trimToBudget(
      lines,
      MAX_PREVIEW_LINES,
      this.opts.config.output.maxOutputBytes,
    );
    const newTotal = this.previewLines.length;

    if (follow) {
      // Show the newest page: the last `available` lines, so the most recent
      // output is visible immediately on select/open (matching 0.9.4).
      this.previewOffset = Math.max(0, newTotal - available);
    } else {
      this.previewOffset = Math.min(
        this.previewOffset,
        Math.max(0, newTotal - 1),
      );
    }
  }

  private isFollowingTail(): boolean {
    return (
      this.previewLines.length === 0 ||
      this.previewOffset >= this.previewLines.length - this.previewHeight()
    );
  }

  private cycleSort(): void {
    this.sort =
      OVERVIEW_SORTS[
        (OVERVIEW_SORTS.indexOf(this.sort) + 1) % OVERVIEW_SORTS.length
      ];
    this.reapplyKeepSelection();
  }

  private cycleFilter(): void {
    this.filter =
      OVERVIEW_FILTERS[
        (OVERVIEW_FILTERS.indexOf(this.filter) + 1) % OVERVIEW_FILTERS.length
      ];
    this.reapplyKeepSelection();
  }

  private reapplyKeepSelection(): void {
    const keepId = this.selectedProcess()?.id;
    const all = requestProcessList(this.opts.events);
    this.hasAnyProcesses = all.length > 0;
    this.totalProcessCount = all.length;
    this.runningProcessCount = all.filter((process) =>
      LIVE_STATUSES.has(process.status),
    ).length;
    this.processes = this.applyView(all);
    const nextIndex = keepId
      ? this.processes.findIndex((process) => process.id === keepId)
      : -1;
    this.selectedIndex =
      nextIndex >= 0
        ? nextIndex
        : Math.min(this.selectedIndex, Math.max(0, this.processes.length - 1));
    this.clampViewOffset();
    this.refreshPreview();
    this.requestRender();
  }

  private killSelected(): void {
    const selected = this.selectedProcess();
    if (!selected) return;
    requestKill(this.opts.events, selected.id);
    // CHANNELS.CHANGED re-renders on kill completion.
  }

  private clearFinished(): void {
    requestClear(this.opts.events);
    // CHANNELS.CHANGED re-renders on clear completion.
  }

  private async pinSelected(): Promise<void> {
    const selected = this.selectedProcess();
    if (!selected) return;
    // Toggle: if the selected process is already pinned, unpin it.
    const isPinned = this.pinnedId === selected.id;
    if (!isPinned && !LIVE_STATUSES.has(selected.status)) {
      this.requestRender();
      return;
    }
    const result = await requestPin(
      this.opts.events,
      isPinned ? null : selected.id,
      PIN_REPLY_TIMEOUT_MS,
    );
    this.pinUnavailable = !result.ok;
    if (result.ok) {
      this.pinnedId = isPinned ? null : selected.id;
    }
    this.requestRender();
  }

  private configureFilterInput(): void {
    this.filterInput.onSubmit = (query) => {
      this.quickFilter = query.trim();
      this.mode = "normal";
      this.reapplyKeepSelection();
    };
    this.filterInput.onEscape = () => {
      this.quickFilter = "";
      this.mode = "normal";
      this.requestRender();
    };
  }

  private startQuickFilter(): void {
    this.filterInput.setValue(this.quickFilter);
    this.mode = "filter-typing";
    this.requestRender();
  }

  private close(): void {
    this.dispose();
    this.opts.onClose();
  }

  private requestRender(): void {
    this.opts.tui.requestRender();
  }

  // --- rendering ---

  private buildBody(): Component {
    if (this.processes.length === 0) {
      return new LinesComponent((w) => this.renderEmptyState(w));
    }

    const body = new Stack({ gap: 0 });
    body.addChild(new LinesComponent((w) => this.renderListRows(w)));
    body.addChild(new LineComponent((w) => this.renderRule(w)));
    body.addChild(new LinesComponent((w) => this.renderPreview(w)));
    return body;
  }

  private buildTooSmallBody(width: number): Component {
    const t = this.opts.theme;
    return new LinesComponent(() => [
      t.fg("warning", "Terminal too small for /ps."),
      t.fg("dim", `Need ${MIN_OVERVIEW_WIDTH} columns, have ${width}.`),
      "",
      t.fg("dim", "Resize and reopen /ps."),
    ]);
  }

  private renderEmptyState(width: number): string[] {
    const t = this.opts.theme;
    const filtering = this.hasAnyProcesses;
    const title = t.fg("muted", "No managed processes");
    const description = t.fg(
      "dim",
      filtering
        ? "No processes match the current filter. Press f or / to change it."
        : "Start one with the process tool, then reopen /ps",
    );
    const titleW = visibleWidth(title);
    const descW = visibleWidth(description);

    // Fixed small block: a couple of blank lines, title, blank, description.
    const lines: string[] = ["", "", "", ""];

    const titleRow = 1;
    const descRow = 3;
    const titlePad = Math.max(0, Math.floor((width - titleW) / 2));
    const descPad = Math.max(0, Math.floor((width - descW) / 2));
    lines[titleRow] = truncateToWidth(
      `${" ".repeat(titlePad)}${title}`,
      width,
      "",
      true,
    );
    lines[descRow] = truncateToWidth(
      `${" ".repeat(descPad)}${description}`,
      width,
      "",
      true,
    );
    return lines;
  }

  private renderPinHint(): string {
    const t = this.opts.theme;
    const dim = (value: string) => t.fg("dim", value);
    const accent = (value: string) => t.fg("accent", value);
    if (this.pinUnavailable) return dim("pin (dock not loaded)");
    const selected = this.selectedProcess();
    if (selected && this.pinnedId === selected.id) {
      return `${accent("unpin")}`;
    }
    if (selected && !LIVE_STATUSES.has(selected.status)) {
      return dim("pin running only");
    }
    return accent("pin");
  }

  private renderHeaderLeft(): string {
    const parts = [
      `${this.runningProcessCount}/${this.totalProcessCount} running`,
    ];
    if (this.sort !== "status") parts.push(`sort: ${this.sort}`);
    if (this.filter !== "all" || this.quickFilter) {
      const filter = `${this.filter}${this.quickFilter ? ` "${this.quickFilter}"` : ""}`;
      parts.push(`filter: ${filter}`);
    }
    return parts.join(" - ");
  }

  private renderHeaderRight(): string {
    const hiddenAbove = this.viewOffset;
    const hiddenBelow = Math.max(
      0,
      this.processes.length - (this.viewOffset + this.maxVisibleRows()),
    );
    return [
      hiddenAbove > 0 ? `↑ ${hiddenAbove} more` : "",
      hiddenBelow > 0 ? `↓ ${hiddenBelow} more` : "",
    ]
      .filter(Boolean)
      .join(" - ");
  }

  private renderRule(width: number): string {
    const t = this.opts.theme;
    return t.fg("dim", "─".repeat(Math.max(0, width)));
  }

  private renderListRows(width: number): string[] {
    const maxVisible = this.maxVisibleRows();
    const start = this.viewOffset;
    const rows: string[] = [];
    for (let offset = 0; offset < maxVisible; offset++) {
      const index = start + offset;
      const process = this.processes[index];
      rows.push(
        process
          ? this.renderRow(process, index === this.selectedIndex, width)
          : "",
      );
    }
    return rows;
  }

  private renderRow(
    process: ProcessInfo,
    selected: boolean,
    width: number,
  ): string {
    const t = this.opts.theme;
    const name = truncateToWidth(process.name, MAX_NAME_WIDTH, "", true);
    const id = truncateToWidth(process.id, MAX_ID_WIDTH, "", true);
    const status = truncateToWidth(
      formatColoredStatusShort(process, t),
      STATUS_WIDTH,
      "",
      true,
    );
    const runtime = truncateToWidth(
      formatRuntime(process.startTime, process.endTime),
      RUNTIME_WIDTH,
      "",
      true,
    );

    const dim = (value: string) => t.fg("dim", value);
    const sep = dim("  ");

    // Leading marker: ◆ for the pinned process, a space otherwise, so every
    // row aligns with no offset when nothing is pinned.
    const marker = this.pinnedId === process.id ? t.fg("accent", "◆") : " ";
    const left = `${marker} ${name}${sep}${dim(id)}${sep}${status}${sep}${runtime}`;
    const remaining = Math.max(0, width - visibleWidth(left) - 2);
    const command = dim(truncateCmd(process.command, remaining));
    const line = `${left}${sep}${command}`;

    if (selected) {
      const padded = truncateToWidth(line, width, "", true);
      const pad = Math.max(0, width - visibleWidth(padded));
      return t.bg("selectedBg", `${padded}${" ".repeat(pad)}`);
    }
    return truncateToWidth(line, width, "", true);
  }

  private renderPreview(width: number): string[] {
    const selected = this.selectedProcess();
    if (!selected) return [];
    const t = this.opts.theme;
    const dim = (value: string) => t.fg("dim", value);
    const accent = (value: string) => t.fg("accent", value);

    const header = `${dim(">")} ${accent(truncateCmd(selected.command, Math.max(1, width - 2)))}`;
    const body: string[] = [header];
    const available = this.previewHeight();
    const total = this.previewLines.length;
    const start = this.previewOffset;
    const slice = this.previewLines.slice(start, start + available);
    for (const line of slice) {
      // Preview lines are untrusted process output: strip anything that could
      // move the cursor or erase the screen, keep color.
      const safe = sanitizeForDisplay(line.text);
      const text = line.type === "stderr" ? t.fg("warning", safe) : safe;
      body.push(
        truncateToWidth(`${dim(PREVIEW_LOG_PREFIX)}${text}`, width, "", true),
      );
    }
    while (body.length < available + 1) body.push("");
    const pageHint =
      total > available
        ? `  ${start + 1}-${Math.min(start + available, total)} of ${total}  (J/K scroll)`
        : "";
    // Keep the overview stable while moving between processes. A short log
    // still reserves the page-hint row that a longer log uses for scrolling.
    body.push(truncateToWidth(dim(pageHint), width, "", true));
    return body;
  }

  private previewHeight(): number {
    // Fixed, bounded preview size. We deliberately do NOT size from the
    // terminal height — the overview is a compact panel, not a full-screen
    // log viewer (use /ps:logs for that).
    return PREVIEW_HEIGHT;
  }

  private buildFooter(): Component {
    return new LineComponent((width) => this.renderFooterLine(width));
  }

  private renderFooterLine(width: number): string {
    const t = this.opts.theme;
    const dim = (value: string) => t.fg("dim", value);

    if (this.mode === "filter-typing") {
      const rendered = this.filterInput.render(60)[0] ?? "";
      return truncateToWidth(
        `${dim("/")}${rendered}  ${dim("enter")} apply  ${dim("esc")} cancel`,
        width,
        "",
        true,
      );
    }

    const keys = [
      `${dim("j/k")} move`,
      `${dim("J/K")} scroll`,
      `${dim("enter")} ${this.renderPinHint()}`,
      `${dim("x")} kill`,
      `${dim("c")} clear`,
      `${dim("s")} sort`,
      `${dim("f")} filter`,
      `${dim("/")} find`,
      `${dim("q")} close`,
    ];
    return truncateToWidth(keys.join("  "), width, "", true);
  }
}

// --- formatting helpers (pure, unit-testable) ---

export { statusDot as renderStatusDot } from "../../shared/ui";

export function formatStatusShort(process: ProcessInfo): string {
  if (LIVE_STATUSES.has(process.status)) return process.status;
  if (process.status === "exited") {
    return process.success === false ? "failed" : "exited";
  }
  return process.status;
}

function formatColoredStatusShort(process: ProcessInfo, theme: Theme): string {
  return theme.fg(statusColor(process), formatStatusShort(process));
}

/** Sort + filter view used by the overview. Pure, unit-testable. */
export function applyOverviewView(
  processes: ProcessInfo[],
  sort: OverviewSort,
  filter: OverviewFilter,
  quickFilter: string,
): ProcessInfo[] {
  const filtered =
    filter === "running"
      ? processes.filter((process) => LIVE_STATUSES.has(process.status))
      : filter === "finished"
        ? processes.filter((process) => !LIVE_STATUSES.has(process.status))
        : processes;
  const quick = quickFilter
    ? filtered.filter((process) =>
        process.name.toLowerCase().includes(quickFilter.toLowerCase()),
      )
    : filtered;
  const copy = [...quick];
  if (sort === "status") {
    copy.sort((a, b) => {
      const aLive = LIVE_STATUSES.has(a.status) ? 1 : 0;
      const bLive = LIVE_STATUSES.has(b.status) ? 1 : 0;
      if (bLive !== aLive) return bLive - aLive;
      return b.startTime - a.startTime;
    });
  } else if (sort === "started") {
    copy.sort((a, b) => b.startTime - a.startTime);
  } else {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy;
}
