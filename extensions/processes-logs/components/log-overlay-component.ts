import { Panel, Stack } from "@aliou/pi-utils-ui";
import type { EventBus, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Input,
  Key,
  matchesKey,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { LIVE_STATUSES, type ProcessInfo } from "../../../src/types";
import { formatRuntime } from "../../../src/utils/format";
import { truncateForDisplay } from "../../shared/display-text";
import { renderProcessTab } from "../../shared/process-tabs";
import {
  CHANNELS,
  type ProcessesChangedPayload,
  type ProcessProtocolConfig,
  type ProcessProtocolNotificationPayload,
} from "../../shared/protocol";
import { truncateToWidth } from "../../shared/truncate";
import { LineComponent, LinesComponent, RuleComponent } from "../../shared/ui";
import { requestProcessList } from "../client";
import {
  connectToProcessLogs,
  type LogsConnection,
  type ProcessLogLine,
} from "../logs-client";
import { LogFileViewer } from "./log-file-viewer";

type OverlayMode = "normal" | "search-typing" | "search-active";

interface LogOverlayOptions {
  events: EventBus;
  tui: TUI;
  theme: Theme;
  initialProcessId?: string;
  config: ProcessProtocolConfig;
  onClose: () => void;
}

const CHROME_LINES = 9;
const MIN_LOG_ROWS = 5;
const MIN_OVERLAY_WIDTH = 80;
const MIN_OVERLAY_HEIGHT = 12;
const OVERLAY_FRACTION = 0.9;
const MAX_NOTIFY_MARKERS_PER_PROCESS = 100;
/** Cap retained viewers so a long session does not hold unbounded buffers. */
const MAX_CACHED_VIEWERS = 12;
/** Throttle chunk-driven renders so the editor under the overlay is not
 * re-rendered at the framework's 60fps cadence on every output burst. */
const RENDER_THROTTLE_MS = 100;

interface NotifyMatchMark {
  pattern: string;
  line: string;
  stream: "stdout" | "stderr";
  matcherIndex: number;
  timestamp: number;
}

export class LogOverlayComponent implements Component {
  private processes: ProcessInfo[] = [];
  private selectedIndex = 0;
  private tabViewOffset = 0;
  private connection: LogsConnection | null = null;
  private viewer: LogFileViewer | null = null;
  private message: string | null = null;
  private mode: OverlayMode = "normal";
  private searchInput = new Input();
  private hasSeenRunningProcess = false;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposers: Array<() => void> = [];
  private disposed = false;
  /** Per-process notify log-match markers, capped per process. */
  private readonly notifyMarkers = new Map<string, NotifyMatchMark[]>();
  /**
   * Per-process cached viewers. A tab switch unsubscribes the live log
   * connection (only one process is subscribed at a time) but preserves the
   * viewer so scroll position, search, follow toggle, and stream filter
   * survive a round-trip. Mirrors the notifyMarkers persistence pattern.
   */
  private readonly viewers = new Map<string, LogFileViewer>();

  constructor(private readonly opts: LogOverlayOptions) {
    this.configureSearchInput();

    this.refreshProcesses(opts.initialProcessId);
    this.disposers.push(
      opts.events.on(CHANNELS.CHANGED, (payload) => {
        this.handleProcessesChanged(payload as ProcessesChangedPayload);
      }),
    );
    this.disposers.push(
      opts.events.on(CHANNELS.NOTIFICATION, (payload) => {
        this.handleNotification(payload);
      }),
    );
  }

  private handleNotification(rawPayload: unknown): void {
    const payload = rawPayload as ProcessProtocolNotificationPayload;
    if (payload.kind !== "log_match" || !payload.logMatch) return;
    const mark: NotifyMatchMark = {
      pattern: payload.logMatch.pattern,
      line: payload.logMatch.line,
      stream: payload.logMatch.stream,
      matcherIndex: payload.logMatch.matcherIndex,
      timestamp: payload.timestamp,
    };

    const list = this.notifyMarkers.get(payload.processId) ?? [];
    list.push(mark);
    if (list.length > MAX_NOTIFY_MARKERS_PER_PROCESS) {
      list.splice(0, list.length - MAX_NOTIFY_MARKERS_PER_PROCESS);
    }
    this.notifyMarkers.set(payload.processId, list);

    const selected = this.selectedProcess();
    if (selected && selected.id === payload.processId) {
      this.viewer?.addNotifyMatch(mark);
      this.opts.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const terminalSize = this.getTerminalSize(width);
    const tooSmall =
      terminalSize.columns < MIN_OVERLAY_WIDTH ||
      terminalSize.rows < MIN_OVERLAY_HEIGHT;
    const panel = new Panel({
      title: "Process Logs",
      body: tooSmall
        ? this.buildTooSmallBody(terminalSize.columns, terminalSize.rows)
        : this.buildBody(),
      footer: tooSmall ? undefined : this.buildFooter(),
      border: "round",
      padding: 0,
      borderStyle: (text) => this.opts.theme.fg("dim", text),
      titleStyle: (text) =>
        this.opts.theme.fg("accent", this.opts.theme.bold(text)),
    });

    return panel.render(width);
  }

  handleInput(data: string): void {
    if (this.mode === "search-typing") {
      this.searchInput.handleInput?.(data);
      this.opts.tui.requestRender();
      return;
    }

    if (this.mode === "search-active") {
      if (matchesKey(data, Key.escape)) {
        this.viewer?.clearSearch();
        this.searchInput.setValue("");
        this.mode = "normal";
        this.opts.tui.requestRender();
        return;
      }
      if (data === "n") {
        this.viewer?.nextMatch();
        this.opts.tui.requestRender();
        return;
      }
      if (data === "N") {
        this.viewer?.previousMatch();
        this.opts.tui.requestRender();
        return;
      }
      if (data === "/") {
        this.searchInput.setValue(this.viewer?.getSearchInfo()?.query ?? "");
        this.mode = "search-typing";
        this.opts.tui.requestRender();
        return;
      }
    }

    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      data === "q" ||
      data === "Q"
    ) {
      this.close();
      return;
    }

    if (matchesKey(data, Key.tab)) this.selectRelative(1);
    else if (matchesKey(data, Key.shift("tab"))) this.selectRelative(-1);
    else if (matchesKey(data, Key.down) || data === "j")
      this.viewer?.scrollBy(-1);
    else if (matchesKey(data, Key.up) || data === "k") this.viewer?.scrollBy(1);
    else if (data === "g") this.viewer?.scrollToTop();
    else if (data === "G") this.viewer?.scrollToBottom();
    else if (data === "s") this.viewer?.cycleStreamFilter();
    else if (data === "f") this.viewer?.toggleFollow();
    else if (data === "w") this.viewer?.toggleWrap();
    else if (data === "/") this.startSearch();

    this.opts.tui.requestRender();
  }

  invalidate(): void {
    return;
  }

  /**
   * Throttle render requests driven by streaming output. The viewer's buffer
   * accumulates every line regardless; this only coalesces the visual update
   * so a fast producer does not force the framework to re-render the editor
   * beneath the overlay 60 times a second. User input and search still call
   * requestRender directly for immediate feedback.
   */
  private scheduleRender(): void {
    if (this.disposed || this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      this.opts.tui.requestRender();
    }, RENDER_THROTTLE_MS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.connection?.unsubscribe();
    this.connection = null;
    this.viewer = null;
    this.viewers.clear();
    this.notifyMarkers.clear();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private configureSearchInput(): void {
    this.searchInput.onSubmit = (query) => {
      const trimmed = query.trim();
      if (trimmed) {
        this.viewer?.setSearch(trimmed);
        this.mode = "search-active";
      } else {
        this.viewer?.clearSearch();
        this.mode = "normal";
      }
      this.opts.tui.requestRender();
    };

    this.searchInput.onEscape = () => {
      this.searchInput.setValue("");
      this.mode = "normal";
      this.opts.tui.requestRender();
    };
  }

  private getTerminalSize(renderWidth: number): {
    columns: number;
    rows: number;
  } {
    return {
      columns:
        process.stdout.columns ?? this.opts.tui.terminal.columns ?? renderWidth,
      rows: process.stdout.rows ?? this.opts.tui.terminal.rows ?? 0,
    };
  }

  private buildTooSmallBody(columns: number, rows: number): Component {
    return new LinesComponent(() => [
      this.opts.theme.fg("warning", "Terminal size too small:"),
      `   Width = ${columns} Height = ${rows}`,
      "",
      "Needed for current config:",
      `  Width = ${MIN_OVERLAY_WIDTH} Height = ${MIN_OVERLAY_HEIGHT}`,
    ]);
  }

  private buildBody(): Component {
    const body = new Stack({ gap: 0 });
    const selected = this.selectedProcess();
    body.addChild(new LineComponent((width) => this.renderTabBar(width)));
    body.addChild(
      new LineComponent((width) => this.renderMetaLine(width, selected)),
    );
    body.addChild(new RuleComponent(this.opts.theme));
    body.addChild(
      new LinesComponent((width) => {
        const logRows = this.logRows();
        if (!selected) return this.renderNoProcesses(width, logRows);
        if (!this.viewer) return this.renderUnavailable(width, logRows);
        return this.viewer.render(width, logRows);
      }),
    );
    return body;
  }

  private buildFooter(): Component {
    return new LineComponent((width) => this.renderFooter(width));
  }

  private renderSearchInput(): string {
    const rendered = this.searchInput.render(80)[0] ?? "";
    return `${this.opts.theme.fg("dim", "/")}${rendered.startsWith("> ") ? rendered.slice(2) : rendered}`;
  }

  private logRows(): number {
    const rows = this.opts.tui.terminal.rows ?? 24;
    const fromTerminal = Math.floor(rows * OVERLAY_FRACTION) - CHROME_LINES;
    return Math.max(
      MIN_LOG_ROWS,
      Math.min(this.opts.config.processList.maxPreviewLines, fromTerminal),
    );
  }

  private close(): void {
    this.dispose();
    this.opts.onClose();
  }

  private refreshProcesses(preferredProcessId?: string): void {
    this.processes = this.sortProcesses(requestProcessList(this.opts.events));
    if (this.processes.some((process) => process.status === "running")) {
      this.hasSeenRunningProcess = true;
    }

    if (this.processes.length === 0) {
      this.selectedIndex = 0;
      this.connection?.unsubscribe();
      this.connection = null;
      this.viewer = null;
      this.pruneRemovedProcesses();
      return;
    }

    const currentId = preferredProcessId ?? this.selectedProcess()?.id;
    const nextIndex = currentId
      ? this.processes.findIndex((process) => process.id === currentId)
      : -1;
    this.selectedIndex =
      nextIndex >= 0
        ? nextIndex
        : Math.min(this.selectedIndex, this.processes.length - 1);
    this.ensureTabVisible();
    this.subscribeToSelected();
    this.pruneRemovedProcesses();
  }

  /** Drop cached viewers/markers for processes that no longer exist. */
  private pruneRemovedProcesses(): void {
    const live = new Set(this.processes.map((process) => process.id));
    for (const id of [...this.viewers.keys()]) {
      if (!live.has(id) && this.viewers.get(id) !== this.viewer) {
        this.viewers.delete(id);
      }
    }
    for (const id of [...this.notifyMarkers.keys()]) {
      if (!live.has(id) && id !== this.selectedProcess()?.id) {
        this.notifyMarkers.delete(id);
      }
    }
  }

  private sortProcesses(processes: ProcessInfo[]): ProcessInfo[] {
    return [...processes].sort((a, b) => {
      const aLive = LIVE_STATUSES.has(a.status) ? 1 : 0;
      const bLive = LIVE_STATUSES.has(b.status) ? 1 : 0;
      if (bLive !== aLive) return bLive - aLive;
      return b.startTime - a.startTime;
    });
  }

  private handleProcessesChanged(change?: ProcessesChangedPayload): void {
    this.refreshProcesses();
    if (this.processes.length === 0 && change?.reason === "cleared") {
      this.opts.tui.requestRender();
      return;
    }
    if (
      this.opts.config.follow.autoHideOnFinish &&
      this.hasSeenRunningProcess &&
      this.processes.every((process) => process.status !== "running")
    ) {
      this.close();
      return;
    }
    this.opts.tui.requestRender();
  }

  private selectRelative(delta: number): void {
    if (this.processes.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex + delta + this.processes.length) %
      this.processes.length;
    this.tabViewOffset = this.selectedIndex;
    this.subscribeToSelected();
  }

  private ensureTabVisible(): void {
    if (this.selectedIndex < this.tabViewOffset) {
      this.tabViewOffset = this.selectedIndex;
    }
    this.tabViewOffset = Math.max(
      0,
      Math.min(this.tabViewOffset, this.selectedIndex),
    );
  }

  private selectedProcess(): ProcessInfo | null {
    return this.processes[this.selectedIndex] ?? null;
  }

  private subscribeToSelected(): void {
    const selected = this.selectedProcess();
    // Drop the live subscription on switch, but keep the viewer (search,
    // scroll, follow, stream filter) cached for the next time this tab is
    // selected. Only one process is subscribed at a time.
    this.connection?.unsubscribe();
    this.connection = null;
    this.viewer = null;
    if (!selected) return;

    const connection = connectToProcessLogs(this.opts.events, selected.id, {
      tailLines: this.opts.config.output.defaultTailLines,
    });

    if (isLogsConnectionError(connection)) {
      this.message = this.opts.theme.fg("warning", connection.error);
      return;
    }

    this.message = null;
    this.connection = connection;

    // Reuse a cached viewer if we already viewed this process; otherwise
    // create one from the fresh initial tail.
    let viewer = this.viewers.get(selected.id);
    if (!viewer) {
      viewer = new LogFileViewer(connection.initialLines, this.opts.theme, {
        followEnabled: this.opts.config.follow.enabledByDefault,
        maxBufferLines: this.opts.config.output.maxOutputLines,
        maxBufferBytes: this.opts.config.output.maxOutputBytes,
      });
      this.viewers.set(selected.id, viewer);
      this.pruneCachedViewers();
    }
    // NOTE: do NOT re-feed connection.initialLines into a cached viewer --
    // doing so would duplicate lines already in its buffer.
    this.viewer = viewer;

    // Re-apply any notify markers that arrived while this viewer was
    // detached (addNotifyMatch is a set, so this is idempotent for ones
    // already applied).
    const stored = this.notifyMarkers.get(selected.id);
    if (stored) for (const mark of stored) viewer.addNotifyMatch(mark);

    connection.onChunk((lines: ProcessLogLine[]) => {
      // The active viewer may have changed by the time a chunk arrives; only
      // feed the one that is still current.
      this.viewer?.appendLines(lines);
      this.scheduleRender();
    });
  }

  /** Keep the retained-viewer map bounded across a long session. */
  private pruneCachedViewers(): void {
    while (this.viewers.size > MAX_CACHED_VIEWERS) {
      const oldest = this.viewers.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.viewers.get(oldest);
      if (removed && removed === this.viewer) {
        // Never evict the currently-displayed viewer; rotate it to the end
        // so a fresher entry is evicted instead.
        this.viewers.delete(oldest);
        this.viewers.set(oldest, removed);
        continue;
      }
      this.viewers.delete(oldest);
    }
  }

  private startSearch(): void {
    this.searchInput.setValue("");
    this.mode = "search-typing";
  }

  private renderTabBar(width: number): string {
    if (this.processes.length === 0)
      return this.opts.theme.fg("dim", "No processes");

    const parts = this.processes.map((process, index) =>
      renderProcessTab(process, index === this.selectedIndex, this.opts.theme),
    );

    const separator = " ";
    const allTabs = parts.join(separator);
    if (visibleWidth(allTabs) <= width) return truncateToWidth(allTabs, width);

    const window = this.renderTabWindow(parts, separator, width);
    return truncateToWidth(window, width, "", true);
  }

  private renderTabWindow(
    parts: string[],
    separator: string,
    width: number,
  ): string {
    const dim = (value: string) => this.opts.theme.fg("dim", value);
    const activeIndex = Math.max(0, this.selectedIndex);
    let start = activeIndex;
    let end = activeIndex;

    while (true) {
      const canGrowLeft = start > 0;
      const canGrowRight = end < parts.length - 1;
      if (!canGrowLeft && !canGrowRight) break;

      const leftFits =
        canGrowLeft &&
        this.tabWindowFits(parts, separator, start - 1, end, width);
      const rightFits =
        canGrowRight &&
        this.tabWindowFits(parts, separator, start, end + 1, width);

      if (!leftFits && !rightFits) break;

      if (leftFits && rightFits) {
        if (activeIndex - start <= end - activeIndex) start--;
        else end++;
      } else if (leftFits) start--;
      else end++;
    }

    const left = start > 0 ? dim("← ") : "";
    const right = end < parts.length - 1 ? dim(" →") : "";
    return `${left}${parts.slice(start, end + 1).join(separator)}${right}`;
  }

  private tabWindowFits(
    parts: string[],
    separator: string,
    start: number,
    end: number,
    width: number,
  ): boolean {
    const left = start > 0 ? this.opts.theme.fg("dim", "← ") : "";
    const right = end < parts.length - 1 ? this.opts.theme.fg("dim", " →") : "";
    const rendered = `${left}${parts.slice(start, end + 1).join(separator)}${right}`;
    return visibleWidth(rendered) <= width;
  }

  private renderMetaLine(width: number, process: ProcessInfo | null): string {
    if (!process) return "";
    const dim = (value: string) => this.opts.theme.fg("dim", value);
    const duration = dim(formatRuntime(process.startTime, process.endTime));
    const durationWidth = visibleWidth(duration);
    const separator = ` ${dim("·")} `;
    const leftPrefix = `${dim(process.id)}${separator}`;
    const availableCommandWidth = Math.max(
      4,
      width - visibleWidth(leftPrefix) - durationWidth - 1,
    );
    const command = dim(
      truncateForDisplay(process.command, availableCommandWidth),
    );
    const left = `${leftPrefix}${command}`;
    const gap = Math.max(1, width - visibleWidth(left) - durationWidth);
    return truncateToWidth(`${left}${" ".repeat(gap)}${duration}`, width);
  }

  private renderNoProcesses(width: number, height: number): string[] {
    return centeredBlock(
      width,
      height,
      this.opts.theme.fg("muted", "Start a process with the process tool."),
    );
  }

  private renderUnavailable(width: number, height: number): string[] {
    return centeredBlock(
      width,
      height,
      this.opts.theme.fg("warning", "Logs unavailable."),
    );
  }

  private renderFooter(width: number): string {
    const status = this.viewer?.getStatusParts() ?? { left: [], right: [] };
    const right = status.right.join("  ");
    const rightWidth = visibleWidth(right);
    const leftWidth = Math.max(1, width - rightWidth - 1);
    const left = this.renderFooterLeft(leftWidth, status.left);
    const gap = Math.max(1, width - visibleWidth(left) - rightWidth);
    return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width);
  }

  private renderFooterLeft(width: number, statusLeft: string[]): string {
    if (this.mode === "search-typing") {
      return truncateToWidth(
        `${this.renderSearchInput()}  ${this.opts.theme.fg("dim", "enter")} apply  ${this.opts.theme.fg("dim", "esc")} cancel`,
        width,
      );
    }

    const leftPrefix = this.message ?? statusLeft.join("  ");
    const prefix = leftPrefix ? `${leftPrefix}  ` : "";
    const keys = this.renderFooterKeys(
      Math.max(1, width - visibleWidth(prefix)),
    );
    return truncateToWidth(`${prefix}${keys}`, width);
  }

  private renderFooterKeys(width: number): string {
    const dim = (value: string) => this.opts.theme.fg("dim", value);
    const accent = (value: string) => this.opts.theme.fg("accent", value);

    if (this.mode === "search-active") {
      return truncateToWidth(
        `${dim("n")} next  ${dim("N")} prev  ${dim("/")} edit  ${dim("esc")} clear  ${dim("j/k")} scroll  ${dim("q")} close`,
        width,
      );
    }

    const streamFilter = this.viewer?.getStreamFilter() ?? "both";
    const stdout =
      streamFilter === "both" || streamFilter === "stdout"
        ? accent("stdout")
        : dim("stdout");
    const stderr =
      streamFilter === "both" || streamFilter === "stderr"
        ? accent("stderr")
        : dim("stderr");

    const wrapOn = this.viewer?.isWrapEnabled() ?? false;
    const wrap = wrapOn ? accent("wrap") : dim("wrap");

    return truncateToWidth(
      `${dim("tab/shift+tab")} switch  ${dim("g/G")} top/bot  ${dim("j/k")} scroll  ${dim("/")} search  ${dim("s:")}${stdout}${dim("+")}${stderr}  ${dim("f")} follow  ${dim("w:")}${wrap}  ${dim("q")} close`,
      width,
    );
  }
}

function isLogsConnectionError(
  connection: LogsConnection | { ok: false; error: string },
): connection is { ok: false; error: string } {
  return "ok" in connection && connection.ok === false;
}

function centeredBlock(
  width: number,
  height: number,
  content: string,
): string[] {
  const lines = Array.from({ length: height }, () => "");
  const row = Math.max(0, Math.floor((height - 1) / 2));
  const leftPad = Math.max(0, Math.floor((width - visibleWidth(content)) / 2));
  lines[row] = truncateToWidth(`${" ".repeat(leftPad)}${content}`, width);
  return lines;
}
