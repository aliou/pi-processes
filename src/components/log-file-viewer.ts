/**
 * LogFileViewer - reads a single log file and renders a scrollable,
 * searchable window of lines.
 *
 * A plain helper class (not a Component). Consumed by LogDockComponent
 * (open mode) and LogOverlayComponent (tabbed overlay). Callers are
 * responsible for polling / invalidating when file content changes.
 */

import { readFileSync } from "node:fs";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { stripAnsi } from "../utils";

export type StreamFilter = "combined" | "stdout" | "stderr";
export type LineFormat = "plain" | "combined";

interface ParsedLine {
  type: "stdout" | "stderr";
  text: string;
}

export interface LogFileViewerOptions {
  filePath: string;
  /** "plain" = raw lines (stdout/stderr files), "combined" = manager's 1:/2: tagged format */
  format: LineFormat;
  theme: Theme;
  /** Start in follow mode (auto-scroll to tail). Default: false */
  follow?: boolean;
}

export class LogFileViewer {
  private filePath: string;
  private format: LineFormat;
  private theme: Theme;

  private follow: boolean;
  /** Lines from bottom; 0 = tail, higher = older. */
  private scrollOffset = 0;
  private streamFilter: StreamFilter = "combined";

  private searchQuery = "";
  private searchMatches: number[] = [];
  private searchCurrentMatch = -1;

  constructor(opts: LogFileViewerOptions) {
    this.filePath = opts.filePath;
    this.format = opts.format;
    this.theme = opts.theme;
    this.follow = opts.follow ?? false;
  }

  // ---------------------------------------------------------------------------
  // File reading
  // ---------------------------------------------------------------------------

  private readAllLines(): ParsedLine[] {
    try {
      const content = readFileSync(this.filePath, "utf-8");
      const rawLines = content.split("\n");
      // Remove trailing empty string produced by a trailing newline.
      if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
        rawLines.pop();
      }

      if (this.format === "plain") {
        return rawLines.map((line) => ({
          type: "stdout" as const,
          text: line,
        }));
      }

      // Combined format: "1:text" = stdout, "2:text" = stderr
      return rawLines.map((line) => {
        if (line.startsWith("2:")) {
          return { type: "stderr" as const, text: line.slice(2) };
        }
        return {
          type: "stdout" as const,
          text: line.startsWith("1:") ? line.slice(2) : line,
        };
      });
    } catch {
      return [];
    }
  }

  private applyFilter(allLines: ParsedLine[]): ParsedLine[] {
    if (this.streamFilter === "combined") return allLines;
    const keep = this.streamFilter === "stdout" ? "stdout" : "stderr";
    return allLines.filter((l) => l.type === keep);
  }

  private computeMatches(lines: ParsedLine[]): number[] {
    if (!this.searchQuery) return [];
    const q = this.searchQuery.toLowerCase();
    return lines.reduce<number[]>((acc, line, i) => {
      if (stripAnsi(line.text).toLowerCase().includes(q)) acc.push(i);
      return acc;
    }, []);
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  scrollToTop(): void {
    this.follow = false;
    this.scrollOffset = Number.MAX_SAFE_INTEGER; // clamped in renderLines
  }

  scrollToBottom(): void {
    this.scrollOffset = 0;
  }

  /** delta > 0 = scroll up (older content), delta < 0 = scroll down (newer). */
  scrollBy(delta: number): void {
    this.scrollOffset = Math.max(0, this.scrollOffset + delta);
  }

  toggleFollow(): boolean {
    this.follow = !this.follow;
    if (this.follow) this.scrollOffset = 0;
    return this.follow;
  }

  isFollowing(): boolean {
    return this.follow;
  }

  cycleStreamFilter(): StreamFilter {
    const order: StreamFilter[] = ["combined", "stdout", "stderr"];
    this.streamFilter =
      order[(order.indexOf(this.streamFilter) + 1) % order.length];
    // Invalidate search since the line set changed.
    this.searchMatches = [];
    this.searchCurrentMatch = -1;
    return this.streamFilter;
  }

  getStreamFilter(): StreamFilter {
    return this.streamFilter;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  setSearch(query: string): void {
    this.searchQuery = query;
    const lines = this.applyFilter(this.readAllLines());
    this.searchMatches = this.computeMatches(lines);
    if (this.searchMatches.length > 0) {
      // Start at the last match so the user lands near the tail.
      this.searchCurrentMatch = this.searchMatches.length - 1;
      this.jumpToMatchLine(
        lines.length,
        this.searchMatches[this.searchCurrentMatch],
      );
    } else {
      this.searchCurrentMatch = -1;
    }
  }

  clearSearch(): void {
    this.searchQuery = "";
    this.searchMatches = [];
    this.searchCurrentMatch = -1;
  }

  private jumpToMatchLine(total: number, lineIdx: number): void {
    this.scrollOffset = Math.max(0, total - lineIdx - 1);
    this.follow = false;
  }

  nextMatch(): void {
    if (this.searchMatches.length === 0) return;
    this.searchCurrentMatch =
      (this.searchCurrentMatch + 1) % this.searchMatches.length;
    const lines = this.applyFilter(this.readAllLines());
    this.jumpToMatchLine(
      lines.length,
      this.searchMatches[this.searchCurrentMatch],
    );
  }

  prevMatch(): void {
    if (this.searchMatches.length === 0) return;
    this.searchCurrentMatch =
      (this.searchCurrentMatch - 1 + this.searchMatches.length) %
      this.searchMatches.length;
    const lines = this.applyFilter(this.readAllLines());
    this.jumpToMatchLine(
      lines.length,
      this.searchMatches[this.searchCurrentMatch],
    );
  }

  getSearchInfo(): { query: string; current: number; total: number } | null {
    if (!this.searchQuery) return null;
    return {
      query: this.searchQuery,
      current: this.searchCurrentMatch + 1, // 1-based for display
      total: this.searchMatches.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Returns up to `maxLines` rendered content lines. */
  renderLines(width: number, maxLines: number): string[] {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const warning = (s: string) => theme.fg("warning", s);
    const accent = (s: string) => theme.fg("accent", s);

    const allLines = this.readAllLines();
    const lines = this.applyFilter(allLines);

    // Refresh matches against current (possibly grown) data.
    if (this.searchQuery) {
      this.searchMatches = this.computeMatches(lines);
      if (this.searchCurrentMatch >= this.searchMatches.length) {
        this.searchCurrentMatch = Math.max(0, this.searchMatches.length - 1);
      }
    }

    const total = lines.length;
    if (total === 0) return [dim("(no output yet)")];

    // Clamp offset to valid range.
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, total - 1));

    const endIdx = this.follow ? total : Math.max(0, total - this.scrollOffset);
    const startIdx = Math.max(0, endIdx - maxLines);

    const currentMatchIdx =
      this.searchCurrentMatch >= 0 &&
      this.searchCurrentMatch < this.searchMatches.length
        ? this.searchMatches[this.searchCurrentMatch]
        : -1;
    const matchSet = new Set(this.searchMatches);

    return lines.slice(startIdx, endIdx).map((line, i) => {
      const absIdx = startIdx + i;
      const text = truncateToWidth(stripAnsi(line.text), width);

      if (absIdx === currentMatchIdx) return accent(text);
      if (matchSet.has(absIdx)) return warning(text);
      if (line.type === "stderr") return warning(text);
      return text;
    });
  }

  /**
   * Returns a single status-bar string exactly `width` characters wide
   * (visible width). Shows position, stream filter, and search state.
   */
  renderStatusBar(width: number): string {
    const theme = this.theme;
    const dim = (s: string) => theme.fg("dim", s);
    const accent = (s: string) => theme.fg("accent", s);

    const lines = this.applyFilter(this.readAllLines());
    const total = lines.length;

    // Right side: position + stream filter
    const rightParts: string[] = [];
    if (this.follow) {
      rightParts.push(accent("following"));
    } else if (total === 0) {
      rightParts.push(dim("empty"));
    } else {
      const endIdx = Math.max(0, total - this.scrollOffset);
      const pct = Math.round((endIdx / total) * 100);
      rightParts.push(dim(`${pct}%  L${Math.min(endIdx, total)}/${total}`));
    }
    if (this.streamFilter !== "combined") {
      rightParts.push(dim(`[${this.streamFilter}]`));
    }

    // Left side: search state
    const searchInfo = this.getSearchInfo();
    let left = "";
    if (searchInfo) {
      left =
        searchInfo.total === 0
          ? theme.fg("error", `no matches: "${searchInfo.query}"`)
          : `${dim("/")}${searchInfo.query}  ${dim(`${searchInfo.current}/${searchInfo.total}`)}`;
    }

    const right = rightParts.join("  ");
    const leftW = visibleWidth(left);
    const rightW = visibleWidth(right);
    const gap = Math.max(1, width - leftW - rightW);
    const bar = left + " ".repeat(gap) + right;
    const barW = visibleWidth(bar);

    if (barW > width) return truncateToWidth(bar, width);
    return bar + " ".repeat(width - barW);
  }
}
