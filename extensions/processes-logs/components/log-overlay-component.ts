import { Panel, Stack } from "@aliou/pi-utils-ui";
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
import { CHANNELS, type ProcessesChangedPayload } from "../../../src/protocol";
import { LIVE_STATUSES, type ProcessInfo } from "../../../src/types";
import { formatRuntime, truncateCmd } from "../../../src/utils/format";
import { requestConfig, requestProcessList } from "../client";
import {
  connectToProcessLogs,
  type LogsConnection,
  type ProcessLogLine,
} from "../logs-client";
import { LogFileViewer } from "./log-file-viewer";
import { statusIcon } from "./status-format";

type OverlayMode = "normal" | "search-typing" | "search-active";

interface LogOverlayOptions {
  events: EventBus;
  tui: TUI;
  theme: Theme;
  initialProcessId?: string;
  onClose: () => void;
}

const CHROME_LINES = 9;
const MIN_LOG_ROWS = 5;
const MIN_OVERLAY_WIDTH = 80;
const MIN_OVERLAY_HEIGHT = 12;
const OVERLAY_FRACTION = 0.9;
const MAX_TAB_NAME = 12;

export class LogOverlayComponent implements Component {
  private processes: ProcessInfo[] = [];
  private selectedIndex = 0;
  private tabViewOffset = 0;
  private connection: LogsConnection | null = null;
  private viewer: LogFileViewer | null = null;
  private message: string | null = null;
  private mode: OverlayMode = "normal";
  private searchInput = new Input();
  private readonly config: ReturnType<typeof requestConfig>;
  private hasSeenRunningProcess = false;
  private readonly disposers: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly opts: LogOverlayOptions) {
    this.config = requestConfig(opts.events);
    this.configureSearchInput();

    this.refreshProcesses(opts.initialProcessId);
    this.disposers.push(
      opts.events.on(CHANNELS.CHANGED, (payload) => {
        const change = payload as ProcessesChangedPayload;
        if (isChangedPayload(change)) this.handleProcessesChanged(change);
      }),
    );
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
    else if (data === "/") this.startSearch();

    this.opts.tui.requestRender();
  }

  invalidate(): void {
    return;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connection?.unsubscribe();
    this.connection = null;
    this.viewer = null;
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
      Math.min(this.config.processList.maxPreviewLines, fromTerminal),
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
      this.config.follow.autoHideOnFinish &&
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
    this.ensureTabVisible();
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
    this.connection?.unsubscribe();
    this.connection = null;
    this.viewer = null;
    if (!selected) return;

    const connection = connectToProcessLogs(this.opts.events, selected.id, {
      tailLines: this.config.output.maxOutputLines,
    });

    if (isLogsConnectionError(connection)) {
      this.message = this.opts.theme.fg("warning", connection.error);
      return;
    }

    this.message = null;
    this.connection = connection;
    this.viewer = new LogFileViewer(connection.initialLines, this.opts.theme, {
      followEnabled: this.config.follow.enabledByDefault,
      maxBufferLines: this.config.output.maxOutputLines,
    });
    connection.onChunk((lines: ProcessLogLine[]) => {
      this.viewer?.appendLines(lines);
      this.opts.tui.requestRender();
    });
  }

  private startSearch(): void {
    this.searchInput.setValue("");
    this.mode = "search-typing";
  }

  private renderTabBar(width: number): string {
    if (this.processes.length === 0)
      return this.opts.theme.fg("dim", "No processes");

    const dim = (value: string) => this.opts.theme.fg("dim", value);
    const accent = (value: string) => this.opts.theme.fg("accent", value);
    const separator = "  ";
    const hasLeft = this.tabViewOffset > 0;
    const left = hasLeft ? dim("← ") : "";
    const tabs: string[] = [];
    let used = visibleWidth(left);
    let lastVisible = this.tabViewOffset - 1;

    for (let i = this.tabViewOffset; i < this.processes.length; i++) {
      const process = this.processes[i];
      if (!process) continue;
      const isActive = i === this.selectedIndex;
      const name = truncateCmd(process.name, MAX_TAB_NAME);
      const icon = this.coloredStatusIcon(process);
      const tab = isActive
        ? `${accent("[")}${icon} ${accent(name)}${accent("]")}`
        : `${dim(" ")}${icon} ${dim(name)}${dim(" ")}`;
      const reserveRight = i < this.processes.length - 1 ? 2 : 0;
      const needed =
        (tabs.length > 0 ? visibleWidth(separator) : 0) + visibleWidth(tab);
      if (used + needed + reserveRight > width) break;
      tabs.push(tab);
      used += needed;
      lastVisible = i;
    }

    const right = lastVisible < this.processes.length - 1 ? dim(" →") : "";
    return truncateToWidth(`${left}${tabs.join(separator)}${right}`, width);
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
    const command = dim(truncateCmd(process.command, availableCommandWidth));
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

    if (this.mode === "search-typing") {
      return truncateToWidth(
        `${dim("enter")} apply  ${dim("esc")} cancel  ${dim("ctrl+u")} clear`,
        width,
      );
    }

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

    return truncateToWidth(
      `${dim("tab/shift+tab")} switch  ${dim("g/G")} top/bot  ${dim("j/k")} scroll  ${dim("/")} search  ${dim("s:")}${stdout}${dim("+")}${stderr}  ${dim("f")} follow  ${dim("q")} close`,
      width,
    );
  }

  private coloredStatusIcon(process: ProcessInfo): string {
    const icon = statusIcon(process.status, process.success);
    if (process.status === "running")
      return this.opts.theme.fg("success", icon);
    if (
      process.status === "terminating" ||
      process.status === "terminate_timeout"
    ) {
      return this.opts.theme.fg("warning", icon);
    }
    if (process.status === "exited" && process.success) {
      return this.opts.theme.fg("dim", icon);
    }
    if (process.status === "exited" || process.status === "killed") {
      return this.opts.theme.fg("error", icon);
    }
    return this.opts.theme.fg("dim", icon);
  }
}

class LineComponent implements Component {
  constructor(private readonly renderLine: (width: number) => string) {}

  render(width: number): string[] {
    return [this.renderLine(width)];
  }

  invalidate(): void {}
}

class LinesComponent implements Component {
  constructor(private readonly renderLines: (width: number) => string[]) {}

  render(width: number): string[] {
    return this.renderLines(width);
  }

  invalidate(): void {}
}

class RuleComponent implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number): string[] {
    return [this.theme.fg("dim", "─".repeat(Math.max(0, width)))];
  }

  invalidate(): void {}
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

function isChangedPayload(
  payload: ProcessesChangedPayload,
): payload is ProcessesChangedPayload {
  return (
    isRecord(payload) &&
    (payload.reason === "started" ||
      payload.reason === "ended" ||
      payload.reason === "cleared")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
