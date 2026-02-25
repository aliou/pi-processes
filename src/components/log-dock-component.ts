/**
 * Log Dock Component - Shows interleaved process logs in the dock.
 *
 * Features:
 * - Collapsed view (1-2 lines: summary + last log line)
 * - Open view (full interleaved logs with panel framing)
 * - Proper panel styling using pi-utils-ui
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

const MAX_LOG_LINES = 10;
const POLL_INTERVAL_MS = 500;

// Color names for process prefixes (theme supports these via fg())
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

  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private cachedState: string = "";

  // Color management
  private processColors: Map<string, ThemeColor> = new Map();
  private colorCounter = 0;
  private themeColors: ThemeColor[] = PROCESS_COLORS;

  constructor(options: LogDockOptions) {
    this.manager = options.manager;
    this.dockState = options.dockState;
    this.theme = options.theme;
    this.tui = options.tui;
    this.dockHeight = options.dockHeight ?? 12;

    // Initialize theme colors
    this.themeColors = [...PROCESS_COLORS];

    // Poll log file for new output
    this.timer = setInterval(() => {
      this.invalidate();
      this.tui.requestRender();
    }, POLL_INTERVAL_MS);

    // Subscribe to dock state changes
    this.unsubscribeDock = this.dockState.subscribe(() => {
      this.invalidate();
      this.tui.requestRender();
    });

    // Subscribe to process events
    this.unsubscribeManager = this.manager.onEvent(() => {
      this.invalidate();
      this.tui.requestRender();
    });
  }

  handleInput(_data: string): boolean {
    // Widget doesn't handle input - user is always in the editor
    return false;
  }

  private getProcessColor(processId: string): ThemeColor {
    const existing = this.processColors.get(processId);
    if (existing) {
      return existing;
    }

    const color = this.themeColors[this.colorCounter % this.themeColors.length];
    this.colorCounter++;
    this.processColors.set(processId, color);
    return color;
  }

  invalidate(): void {
    this.cachedWidth = 0;
    this.cachedLines = [];
  }

  render(width: number): string[] {
    const state = this.dockState.getState();
    const stateKey = `${state.visibility}-${state.followEnabled}`;

    // Check if we can use cached result
    if (
      width === this.cachedWidth &&
      this.cachedLines.length > 0 &&
      this.cachedState === stateKey
    ) {
      return this.cachedLines;
    }

    this.cachedState = stateKey;

    if (state.visibility === "hidden") {
      this.cachedLines = [];
      this.cachedWidth = width;
      return this.cachedLines;
    }

    if (state.visibility === "collapsed") {
      this.cachedLines = this.renderCollapsed(width);
    } else {
      this.cachedLines = this.renderOpen(width);
    }

    this.cachedWidth = width;
    return this.cachedLines;
  }

  private renderCollapsed(width: number): string[] {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const fg = (color: ThemeColor, s: string) => theme.fg(color, s);

    const processes = this.manager.list();

    if (processes.length === 0) {
      return [
        renderPanelRule(width, theme),
        this.padLine(dim("No processes"), width),
        renderPanelRule(width, theme),
      ];
    }

    // Build process summary
    const running = processes.filter((p) => LIVE_STATUSES.has(p.status));
    const finished = processes.filter((p) => !LIVE_STATUSES.has(p.status));

    const parts: string[] = [];

    // Show running processes as colored dots
    for (const proc of running) {
      const color = this.getProcessColor(proc.id);
      parts.push(`${fg(color, "●")} ${proc.name}`);
    }

    // Show finished count
    if (finished.length > 0) {
      parts.push(dim(`+${finished.length} finished`));
    }

    // First line: summary
    const dockState = this.dockState.getState();
    const followStatus = dockState.followEnabled
      ? fg("success", "follow:on")
      : dim("follow:off");

    const firstLine = `${parts.join(" | ")} | ${followStatus}`;

    // Second line: last log entry (from any running process)
    const lines = [
      renderPanelRule(width, theme),
      this.padLine(truncateToWidth(firstLine, width - 2), width),
    ];

    if (running.length > 0) {
      const lastLogs = this.manager.getCombinedOutput(running[0].id, 1);
      if (lastLogs && lastLogs.length > 0) {
        const lastLog = truncateToWidth(
          lastLogs[lastLogs.length - 1].text,
          width - 2,
        );
        lines.push(this.padLine(dim(lastLog), width));
      }
    }

    lines.push(renderPanelRule(width, theme));

    return lines;
  }

  private renderOpen(width: number): string[] {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const fg = (color: ThemeColor, s: string) => theme.fg(color, s);

    const processes = this.manager.list();
    const basePadLine = createPanelPadder(width);
    const padLine = (content: string): string => {
      const contentWidth = visibleWidth(content);
      const innerWidth = width - 2;
      return basePadLine(
        contentWidth > innerWidth
          ? truncateToWidth(content, innerWidth)
          : content,
      );
    };

    if (processes.length === 0) {
      return [
        renderPanelTitleLine("Process Logs", width, theme),
        padLine(dim("No processes")),
        padLine(dim("Run /ps <command> to start")),
        renderPanelRule(width, theme),
      ];
    }

    const lines: string[] = [];

    // Header
    lines.push(renderPanelTitleLine("Process Logs", width, theme));

    // Running processes logs
    const running = processes.filter((p) => LIVE_STATUSES.has(p.status));
    const finished = processes
      .filter((p) => !LIVE_STATUSES.has(p.status))
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));

    // Show logs from running processes
    for (const proc of running) {
      const color = this.getProcessColor(proc.id);
      const prefix = fg(color, `[${proc.name.slice(0, 8)}]`);

      const logLines = this.manager.getCombinedOutput(proc.id, MAX_LOG_LINES);
      if (logLines && logLines.length > 0) {
        for (const log of logLines) {
          const text = truncateToWidth(log.text, width - prefix.length - 4);
          if (log.type === "stderr") {
            lines.push(padLine(`${prefix} ${fg("warning", text)}`));
          } else {
            lines.push(padLine(`${prefix} ${text}`));
          }
        }
      }
    }

    // Finished processes header
    if (finished.length > 0) {
      lines.push(padLine(""));
      lines.push(renderPanelRule(width, theme));
      lines.push(padLine(dim("Finished:")));

      // Show last line from finished processes
      for (const proc of finished.slice(0, 5)) {
        const color = this.getProcessColor(proc.id);
        const prefix = fg(color, `[${proc.name.slice(0, 8)}]`);
        const logLines = this.manager.getCombinedOutput(proc.id, 1);
        if (logLines && logLines.length > 0) {
          const text = truncateToWidth(
            logLines[0].text,
            width - prefix.length - 4,
          );
          lines.push(padLine(`${prefix} ${text}`));
        }
      }
    }

    // Footer
    lines.push(renderPanelRule(width, theme));

    return lines.slice(0, this.dockHeight);
  }

  private padLine(content: string, width: number): string {
    const contentWidth = visibleWidth(content);
    if (contentWidth >= width) {
      return truncateToWidth(content, width);
    }
    return content + " ".repeat(width - contentWidth);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.unsubscribeDock?.();
    this.unsubscribeManager?.();
    this.processColors.clear();
  }
}
