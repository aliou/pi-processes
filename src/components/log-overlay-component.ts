/**
 * LogOverlayComponent - tabbed log viewer as a floating overlay.
 *
 * Layout (CHROME_LINES = 7, logRows computed from terminal height):
 *
 *   ╭──────────── Process Logs ─────────────╮
 *   │  [● backend]  ✓ frontend   ✗ worker   │
 *   ├───────────────────────────────────────┤
 *   │  log line 1                           │
 *   │  ...                                  │
 *   ├───────────────────────────────────────┤
 *   │  /query  1/4              42%  L50/120│
 *   │  ←/→ tab  g/G  j/k  /  n/N  s  f  q  │
 *   ╰───────────────────────────────────────╯
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  type Component,
  Input,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { LIVE_STATUSES, type ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { LogFileViewer } from "./log-file-viewer";
import { statusIcon } from "./status-format";

// Lines that aren't log content: top border + tabs + divider + divider + status + footer + bottom border
const CHROME_LINES = 6;
const MIN_LOG_ROWS = 5;
const OVERLAY_FRACTION = 0.8;
const MAX_TAB_NAME = 12;

type OverlayMode = "normal" | "search-typing" | "search-active";

interface LogOverlayOptions {
  tui: TUI;
  theme: Theme;
  manager: ProcessManager;
  /** Pre-select this process on open. If absent, uses first in list. */
  initialProcessId?: string;
  done: () => void;
}

export class LogOverlayComponent implements Component {
  private tui: TUI;
  private theme: Theme;
  private manager: ProcessManager;
  private done: () => void;

  private processes: ProcessInfo[] = [];
  private tabIndex = 0;
  private tabViewOffset = 0;

  /** One LogFileViewer per process id, lazy-created on first visit. */
  private viewers: Map<string, LogFileViewer> = new Map();

  private mode: OverlayMode = "normal";
  private searchInput: Input = new Input();

  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeManager: (() => void) | null = null;

  constructor(opts: LogOverlayOptions) {
    this.tui = opts.tui;
    this.theme = opts.theme;
    this.manager = opts.manager;
    this.done = opts.done;

    this.processes = this.sortProcesses(this.manager.list());

    if (opts.initialProcessId) {
      const idx = this.processes.findIndex(
        (p) => p.id === opts.initialProcessId,
      );
      if (idx >= 0) this.tabIndex = idx;
    }

    this.unsubscribeManager = this.manager.onEvent(() => {
      const next = this.manager.list();
      // Auto-close when all processes have been cleared.
      if (next.length === 0) {
        this.close();
        return;
      }
      this.processes = this.sortProcesses(next);
      this.tabIndex = Math.min(this.tabIndex, this.processes.length - 1);
      this.tui.requestRender();
    });

    this.timer = setInterval(() => {
      this.tui.requestRender();
    }, 300);

    this.searchInput.onSubmit = (query) => {
      const trimmed = query.trim();
      if (trimmed) {
        this.currentViewer()?.setSearch(trimmed);
        this.mode = "search-active";
      } else {
        this.currentViewer()?.clearSearch();
        this.mode = "normal";
      }
      this.tui.requestRender();
    };

    this.searchInput.onEscape = () => {
      this.mode = "normal";
      this.searchInput.setValue("");
      this.tui.requestRender();
    };
  }

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  private sortProcesses(list: ProcessInfo[]): ProcessInfo[] {
    const isLive = (p: ProcessInfo) => LIVE_STATUSES.has(p.status);
    return [...list].sort((a, b) => {
      const aLive = isLive(a) ? 1 : 0;
      const bLive = isLive(b) ? 1 : 0;
      if (bLive !== aLive) return bLive - aLive; // live first
      return b.startTime - a.startTime; // most recent first within each group
    });
  }

  // ---------------------------------------------------------------------------
  // Viewer lifecycle
  // ---------------------------------------------------------------------------

  private getViewer(proc: ProcessInfo): LogFileViewer | null {
    let viewer = this.viewers.get(proc.id);
    if (!viewer) {
      const logFiles = this.manager.getLogFiles(proc.id);
      if (!logFiles) return null;
      viewer = new LogFileViewer({
        filePath: logFiles.combinedFile,
        format: "combined",
        theme: this.theme,
        follow: false,
      });
      this.viewers.set(proc.id, viewer);
    }
    return viewer;
  }

  private currentProcess(): ProcessInfo | null {
    return this.processes[this.tabIndex] ?? null;
  }

  private currentViewer(): LogFileViewer | null {
    const proc = this.currentProcess();
    if (!proc) return null;
    return this.getViewer(proc) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.unsubscribeManager?.();
    this.unsubscribeManager = null;
    this.done();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  handleInput(data: string): boolean {
    if (this.mode === "search-typing")
      return this.handleSearchTypingInput(data);
    if (this.mode === "search-active")
      return this.handleSearchActiveInput(data);
    return this.handleNormalInput(data);
  }

  private handleNormalInput(data: string): boolean {
    const viewer = this.currentViewer();

    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.close();
      return true;
    }

    if (data === "\t") {
      this.nextTab();
      return true;
    }
    if (matchesKey(data, "shift+tab")) {
      this.prevTab();
      return true;
    }

    if (!viewer) return true;

    if (data === "g") {
      viewer.scrollToTop();
      this.tui.requestRender();
      return true;
    }
    if (data === "G") {
      viewer.scrollToBottom();
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, "down") || data === "j") {
      viewer.scrollBy(1);
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, "up") || data === "k") {
      viewer.scrollBy(-1);
      this.tui.requestRender();
      return true;
    }
    if (data === "f") {
      viewer.toggleFollow();
      this.tui.requestRender();
      return true;
    }
    if (data === "s") {
      viewer.cycleStreamFilter();
      this.tui.requestRender();
      return true;
    }

    if (data === "/") {
      this.searchInput.setValue("");
      this.mode = "search-typing";
      this.tui.requestRender();
      return true;
    }
    return true;
  }

  private handleSearchTypingInput(data: string): boolean {
    // Delegate all editing to the Input component.
    // onSubmit / onEscape are wired in the constructor and fire synchronously.
    this.searchInput.handleInput(data);
    this.tui.requestRender();
    return true;
  }

  private handleSearchActiveInput(data: string): boolean {
    if (matchesKey(data, "escape")) {
      this.currentViewer()?.clearSearch();
      this.mode = "normal";
      this.searchInput.setValue("");
      this.tui.requestRender();
      return true;
    }
    if (data === "n") {
      this.currentViewer()?.nextMatch();
      this.tui.requestRender();
      return true;
    }
    if (data === "N") {
      this.currentViewer()?.prevMatch();
      this.tui.requestRender();
      return true;
    }
    if (data === "/") {
      // Re-open typing with current query pre-filled.
      const current = this.currentViewer()?.getSearchInfo()?.query ?? "";
      this.searchInput.setValue(current);
      this.mode = "search-typing";
      this.tui.requestRender();
      return true;
    }
    // All other keys: normal navigation (j/k, g/G, f, s, Tab, q, etc.)
    return this.handleNormalInput(data);
  }

  private prevTab(): void {
    if (this.processes.length === 0) return;
    this.tabIndex =
      (this.tabIndex - 1 + this.processes.length) % this.processes.length;
    this.ensureTabVisible();
    this.tui.requestRender();
  }

  private nextTab(): void {
    if (this.processes.length === 0) return;
    this.tabIndex = (this.tabIndex + 1) % this.processes.length;
    this.ensureTabVisible();
    this.tui.requestRender();
  }

  private ensureTabVisible(): void {
    if (this.tabIndex < this.tabViewOffset) {
      this.tabViewOffset = this.tabIndex;
    }
    this.tabViewOffset = Math.max(
      0,
      Math.min(this.tabViewOffset, this.tabIndex),
    );
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(width: number): string[] {
    const totalRows = this.tui.terminal.rows ?? 24;
    const logRows = Math.max(
      MIN_LOG_ROWS,
      Math.floor(totalRows * OVERLAY_FRACTION) - CHROME_LINES,
    );

    const theme = this.theme;
    // innerWidth = space available for content inside "│ " and " │"
    const innerWidth = width - 4;
    const border = (s: string) => theme.fg("dim", s);
    const accent = (s: string) => theme.fg("accent", s);
    const dim = (s: string) => theme.fg("dim", s);

    // Pad content to exactly innerWidth visible chars, then wrap in borders.
    const pad = (s: string): string => {
      const w = visibleWidth(s);
      if (w > innerWidth) return truncateToWidth(s, innerWidth);
      return s + " ".repeat(innerWidth - w);
    };
    const row = (content: string): string =>
      `${border("│ ")}${pad(content)}${border(" │")}`;
    const divider = (): string => border(`├${"─".repeat(width - 2)}┤`);

    const lines: string[] = [];

    // ── Top border with centered title ──────────────────────────────────────
    const title = " Process Logs ";
    const titleW = visibleWidth(title);
    const sideTotal = Math.max(0, width - 2 - titleW);
    const leftDash = Math.floor(sideTotal / 2);
    const rightDash = sideTotal - leftDash;
    lines.push(
      border(`╭${"─".repeat(leftDash)}`) +
        accent(title) +
        border(`${"─".repeat(rightDash)}╮`),
    );

    // ── Tab bar ─────────────────────────────────────────────────────────────
    lines.push(row(this.renderTabBar(innerWidth)));

    // ── Divider ─────────────────────────────────────────────────────────────
    lines.push(divider());

    // ── Log content ─────────────────────────────────────────────────────────
    const viewer = this.currentViewer();
    if (!viewer || this.processes.length === 0) {
      for (let i = 0; i < logRows; i++) {
        lines.push(
          row(i === Math.floor(logRows / 2) ? dim("No processes") : ""),
        );
      }
    } else {
      const contentLines = viewer.renderLines(innerWidth, logRows);
      // Overlay "following" indicator at bottom-right of the content area.
      if (viewer.isFollowing()) {
        const indicator = theme.fg("accent", "following");
        const indicatorW = visibleWidth(indicator);
        const targetIdx = logRows - 1;
        const line = contentLines[targetIdx] ?? "";
        const truncated = truncateToWidth(line, innerWidth - indicatorW);
        const truncW = visibleWidth(truncated);
        contentLines[targetIdx] =
          truncated +
          " ".repeat(Math.max(0, innerWidth - truncW - indicatorW)) +
          indicator;
      }
      for (let i = 0; i < logRows; i++) {
        lines.push(row(contentLines[i] ?? ""));
      }
    }

    // ── Divider ─────────────────────────────────────────────────────────────
    lines.push(divider());

    // ── Status bar ──────────────────────────────────────────────────────────
    const statusContent = this.renderStatusContent(innerWidth, viewer);
    lines.push(row(statusContent));

    // ── Footer / keybindings ────────────────────────────────────────────────
    lines.push(row(this.renderFooterContent(innerWidth)));

    return lines;
  }

  private renderTabBar(innerWidth: number): string {
    if (this.processes.length === 0) {
      return this.theme.fg("dim", "No processes");
    }

    const theme = this.theme;
    const accent = (s: string) => theme.fg("accent", s);
    const dim = (s: string) => theme.fg("dim", s);
    const success = (s: string) => theme.fg("success", s);
    const warning = (s: string) => theme.fg("warning", s);
    const error = (s: string) => theme.fg("error", s);

    const coloredIcon = (proc: ProcessInfo): string => {
      const icon = statusIcon(proc.status, proc.success);
      switch (proc.status) {
        case "running":
          return success(icon);
        case "terminating":
        case "terminate_timeout":
          return warning(icon);
        case "killed":
          return error(icon);
        case "exited":
          return proc.success ? dim(icon) : error(icon);
        default:
          return dim(icon);
      }
    };

    // Overflow indicators reserve 2 chars each.
    const OVERFLOW_W = 2;
    const SEP = "  ";
    const SEP_W = 2;

    const hasLeft = this.tabViewOffset > 0;
    let usedWidth = hasLeft ? OVERFLOW_W : 0;
    const tabStrings: string[] = [];
    let lastVisible = this.tabViewOffset - 1;

    for (let i = this.tabViewOffset; i < this.processes.length; i++) {
      const proc = this.processes[i];
      if (!proc) continue;
      const isActive = i === this.tabIndex;

      const namePlain = proc.name.slice(0, MAX_TAB_NAME);
      // Visible width of this tab: "icon name" plus brackets if active.
      // Active: "[icon name]" = 1 + 1(icon) + 1(space) + nameLen + 1 = nameLen + 4
      // Inactive: " icon name " = 1 + 1(icon) + 1(space) + nameLen + 1 = nameLen + 4 (same)
      const tabW = 1 + 1 + 1 + namePlain.length + 1; // bracket + icon + space + name + bracket
      const needed = tabStrings.length > 0 ? SEP_W + tabW : tabW;
      const rightReserve = i < this.processes.length - 1 ? OVERFLOW_W : 0;

      if (usedWidth + needed + rightReserve > innerWidth) break;

      usedWidth += needed;
      lastVisible = i;

      const icon = coloredIcon(proc);
      const name = isActive ? accent(namePlain) : dim(namePlain);
      if (isActive) {
        tabStrings.push(`${accent("[")}${icon} ${name}${accent("]")}`);
      } else {
        tabStrings.push(`${dim(" ")}${icon} ${name}${dim(" ")}`);
      }
    }

    const hasRight = lastVisible < this.processes.length - 1;
    const left = hasLeft ? dim("← ") : "";
    const right = hasRight ? dim(" →") : "";

    return left + tabStrings.join(SEP) + right;
  }

  private renderStatusContent(
    innerWidth: number,
    viewer: LogFileViewer | null,
  ): string {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);

    if (this.mode === "search-typing") {
      // Input renders as "> <text>" — replace "> " with "/" for search prompt.
      // Reserve innerWidth - 1 chars for Input so the "/" prefix fits.
      const inputWidth = Math.max(1, innerWidth - 1);
      const rendered = this.searchInput.render(inputWidth);
      const inputLine = rendered[0] ?? "";
      // Input always prefixes with "> " (2 plain chars, no ANSI before them).
      const withSlash = dim("/") + inputLine.slice(2);
      const w = visibleWidth(withSlash);
      if (w >= innerWidth) return truncateToWidth(withSlash, innerWidth);
      return withSlash + " ".repeat(Math.max(0, innerWidth - w));
    }

    if (!viewer) return "";
    // LogFileViewer.renderStatusBar() returns a string padded to given width.
    return viewer.renderStatusBar(innerWidth);
  }

  private renderFooterContent(innerWidth: number): string {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const accent = (s: string) => theme.fg("accent", s);

    if (this.mode === "search-typing") {
      const hint = `${dim("enter")} apply  ${dim("esc")} cancel  ${dim("ctrl+u")} clear`;
      const w = visibleWidth(hint);
      if (w >= innerWidth) return truncateToWidth(hint, innerWidth);
      return hint + " ".repeat(innerWidth - w);
    }

    if (this.mode === "search-active") {
      const hint =
        `${dim("n")} next  ` +
        `${dim("N")} prev  ` +
        `${dim("/")} edit search  ` +
        `${dim("esc")} clear  ` +
        `${dim("j/k")} scroll  ` +
        `${dim("f")} follow  ` +
        `${dim("q")} quit`;
      const w = visibleWidth(hint);
      if (w >= innerWidth) return truncateToWidth(hint, innerWidth);
      return hint + " ".repeat(innerWidth - w);
    }

    const viewer = this.currentViewer();
    const streamFilter = viewer?.getStreamFilter() ?? "combined";
    // Show stdout+stderr with only the active stream(s) highlighted.
    const stdoutPart =
      streamFilter === "combined" || streamFilter === "stdout"
        ? accent("stdout")
        : dim("stdout");
    const stderrPart =
      streamFilter === "combined" || streamFilter === "stderr"
        ? accent("stderr")
        : dim("stderr");
    const streamIndicator = `${dim("s:")}${stdoutPart}${dim("+")}${stderrPart}`;

    const footer =
      `${dim("tab/shift+tab")} switch  ` +
      `${dim("g/G")} top/bot  ` +
      `${dim("j/k")} scroll  ` +
      `${dim("/")} search  ` +
      streamIndicator +
      `  ${dim("f")} follow  ` +
      `${dim("q")} quit`;

    const w = visibleWidth(footer);
    if (w >= innerWidth) return truncateToWidth(footer, innerWidth);
    return footer + " ".repeat(innerWidth - w);
  }

  invalidate(): void {
    // No local cache.
  }
}
