/**
 * Log Dock Component - shows process logs in the bottom dock.
 *
 * Collapsed view: one-line summary (running procs + follow status) + last log line.
 * Open view: LogFileViewer for the focused process (or first running), follow mode on.
 */

import {
  createPanelPadder,
  renderPanelRule,
  renderPanelTitleLine,
} from "@aliou/pi-utils-ui";
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { LIVE_STATUSES } from "../constants";
import type { ProcessManager } from "../manager";
import type { DockStateManager } from "../state/dock-state";
import { LogFileViewer } from "./log-file-viewer";

const POLL_INTERVAL_MS = 500;

const PROCESS_COLORS: ThemeColor[] = [
  "accent",
  "warning",
  "success",
  "error",
  "accent",
  "dim",
  "accent",
  "warning",
];

interface LogDockOptions {
  manager: ProcessManager;
  dockState: DockStateManager;
  theme: Theme;
  tui: { requestRender: () => void };
  dockHeight?: number;
}

export class LogDockComponent implements Component {
  private manager: ProcessManager;
  private dockState: DockStateManager;
  private theme: Theme;
  private tui: { requestRender: () => void };
  private dockHeight: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeDock: (() => void) | null = null;
  private unsubscribeManager: (() => void) | null = null;

  /** One viewer per process, lazily created, follow:true. */
  private viewers: Map<string, LogFileViewer> = new Map();

  private processColors: Map<string, ThemeColor> = new Map();
  private colorCounter = 0;

  constructor(options: LogDockOptions) {
    this.manager = options.manager;
    this.dockState = options.dockState;
    this.theme = options.theme;
    this.tui = options.tui;
    this.dockHeight = options.dockHeight ?? 12;

    this.timer = setInterval(() => {
      this.tui.requestRender();
    }, POLL_INTERVAL_MS);

    this.unsubscribeDock = this.dockState.subscribe(() => {
      this.tui.requestRender();
    });

    this.unsubscribeManager = this.manager.onEvent(() => {
      this.tui.requestRender();
    });
  }

  handleInput(_data: string): boolean {
    return false;
  }

  invalidate(): void {
    // No local cache; always renders fresh.
  }

  private getProcessColor(processId: string): ThemeColor {
    const existing = this.processColors.get(processId);
    if (existing) return existing;
    const color = PROCESS_COLORS[this.colorCounter % PROCESS_COLORS.length];
    this.colorCounter++;
    this.processColors.set(processId, color);
    return color;
  }

  private getViewer(processId: string, combinedFile: string): LogFileViewer {
    let viewer = this.viewers.get(processId);
    if (!viewer) {
      viewer = new LogFileViewer({
        filePath: combinedFile,
        format: "combined",
        theme: this.theme,
        follow: true,
      });
      this.viewers.set(processId, viewer);
    }
    return viewer;
  }

  render(width: number): string[] {
    const state = this.dockState.getState();

    if (state.visibility === "hidden") return [];
    if (state.visibility === "collapsed") return this.renderCollapsed(width);
    return this.renderOpen(width);
  }

  private renderCollapsed(width: number): string[] {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const fg = (color: ThemeColor, s: string) => theme.fg(color, s);

    const processes = this.manager.list();
    const innerWidth = width - 2;
    const padLine = (content: string) => {
      const w = visibleWidth(content);
      const line =
        w > innerWidth ? truncateToWidth(content, innerWidth) : content;
      return ` ${line}${" ".repeat(Math.max(0, width - 1 - visibleWidth(line)))}`;
    };

    if (processes.length === 0) {
      return [
        renderPanelRule(width, theme),
        padLine(dim("No processes")),
        renderPanelRule(width, theme),
      ];
    }

    const running = processes.filter((p) => LIVE_STATUSES.has(p.status));
    const finished = processes.filter((p) => !LIVE_STATUSES.has(p.status));

    const parts: string[] = [];
    for (const proc of running) {
      const color = this.getProcessColor(proc.id);
      parts.push(`${fg(color, "●")} ${proc.name}`);
    }
    if (finished.length > 0) {
      parts.push(dim(`+${finished.length} finished`));
    }

    const dockState = this.dockState.getState();
    const followStatus = dockState.followEnabled
      ? fg("success", "follow:on")
      : dim("follow:off");

    const firstLine = `${parts.join(" | ")} | ${followStatus}`;
    const lines = [
      renderPanelRule(width, theme),
      padLine(truncateToWidth(firstLine, innerWidth)),
    ];

    if (running.length > 0) {
      const lastLogs = this.manager.getCombinedOutput(running[0].id, 1);
      if (lastLogs && lastLogs.length > 0) {
        const lastLog = truncateToWidth(
          lastLogs[lastLogs.length - 1].text,
          innerWidth,
        );
        lines.push(padLine(dim(lastLog)));
      }
    }

    lines.push(renderPanelRule(width, theme));
    return lines;
  }

  private renderOpen(width: number): string[] {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);

    const innerWidth = width - 2;
    const basePadLine = createPanelPadder(width);
    const padLine = (content: string): string => {
      const w = visibleWidth(content);
      return basePadLine(
        w > innerWidth ? truncateToWidth(content, innerWidth) : content,
      );
    };

    // Resolve which process to show: focused > first running > first overall.
    const state = this.dockState.getState();
    const processes = this.manager.list();
    const running = processes.filter((p) => LIVE_STATUSES.has(p.status));

    const targetProc =
      (state.focusedProcessId
        ? processes.find((p) => p.id === state.focusedProcessId)
        : null) ??
      running[0] ??
      processes[0] ??
      null;

    if (!targetProc) {
      return [
        renderPanelTitleLine("Process Logs", width, theme),
        padLine(dim("No processes")),
        padLine(dim("Run a command to start")),
        renderPanelRule(width, theme),
      ];
    }

    const logFiles = this.manager.getLogFiles(targetProc.id);
    if (!logFiles) {
      return [
        renderPanelTitleLine("Process Logs", width, theme),
        padLine(dim("Log files unavailable")),
        renderPanelRule(width, theme),
      ];
    }

    const viewer = this.getViewer(targetProc.id, logFiles.combinedFile);

    // Available rows for log lines: dockHeight minus chrome (title + bottom rule).
    const logRows = Math.max(1, this.dockHeight - 2);

    const title = `${targetProc.name} ${dim(`(${targetProc.id})`)}`;
    const lines: string[] = [];
    lines.push(renderPanelTitleLine(title, width, theme));

    const contentLines = viewer.renderLines(innerWidth, logRows);
    for (let i = 0; i < logRows; i++) {
      lines.push(padLine(contentLines[i] ?? ""));
    }

    lines.push(renderPanelRule(width, theme));

    // Slice to dockHeight in case of overflow.
    return lines.slice(0, this.dockHeight);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.unsubscribeDock?.();
    this.unsubscribeManager?.();
    this.viewers.clear();
    this.processColors.clear();
  }
}
