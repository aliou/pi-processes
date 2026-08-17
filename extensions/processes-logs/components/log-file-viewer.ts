import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  plainTextForDisplay,
  sanitizeForDisplay,
} from "../../shared/display-text";
import { trimToBudget } from "../../shared/line-buffer";
import {
  displayTextOf,
  type LogLineEmphasis,
  renderLogLine,
  renderLogLineWrap,
} from "../../shared/log-line";
import { truncateToWidth } from "../../shared/truncate";
import type { ProcessLogLine } from "../logs-client";

interface DisplayRow {
  text: string;
  logicalIndex: number;
}

export type StreamFilter = "both" | "stdout" | "stderr";

interface LogFileViewerOptions {
  followEnabled: boolean;
  maxBufferLines: number;
  maxBufferBytes?: number;
}

export class LogFileViewer {
  private lines: ProcessLogLine[];
  private anchorEnd: number | null = null;
  private follow: boolean;
  private streamFilter: StreamFilter = "both";
  private searchQuery = "";
  private searchMatches: number[] = [];
  private searchCurrentMatch = -1;
  private centerTarget: number | null = null;
  private wrapEnabled = false;
  private lastRenderWidth = 0;
  private readonly notifyLines = new Set<string>();

  constructor(
    initialLines: ProcessLogLine[],
    private readonly theme: Theme,
    private readonly options: LogFileViewerOptions,
  ) {
    this.follow = options.followEnabled;
    this.lines = trimToBudget(
      initialLines.map(sanitizeLine),
      options.maxBufferLines,
      options.maxBufferBytes ?? Number.MAX_SAFE_INTEGER,
    );
    this.refreshMatches();
  }

  appendLines(lines: ProcessLogLine[]): void {
    if (lines.length === 0) return;
    this.lines.push(...lines.map(sanitizeLine));
    this.lines = trimToBudget(
      this.lines,
      this.options.maxBufferLines,
      this.options.maxBufferBytes ?? Number.MAX_SAFE_INTEGER,
    );
    this.refreshMatches();
    if (this.follow) this.anchorEnd = null;
  }

  scrollBy(delta: number): void {
    this.follow = false;
    this.anchorEnd ??= this.totalDisplayRows(0);
    this.anchorEnd = Math.max(
      0,
      Math.min(this.totalDisplayRows(0), this.anchorEnd - delta),
    );
  }

  scrollToTop(): void {
    this.follow = false;
    this.anchorEnd = 0;
  }

  scrollToBottom(): void {
    this.follow = false;
    this.anchorEnd = this.totalDisplayRows(0);
  }

  toggleFollow(): boolean {
    this.follow = !this.follow;
    this.anchorEnd = this.follow ? null : this.totalDisplayRows(0);
    return this.follow;
  }

  isFollowing(): boolean {
    return this.follow;
  }

  toggleWrap(): boolean {
    this.wrapEnabled = !this.wrapEnabled;
    // Reset anchor so the viewport snaps to the latest content in the new
    // display-row space (row counts change when wrap toggles).
    this.anchorEnd = this.follow ? null : this.totalDisplayRows(0);
    return this.wrapEnabled;
  }

  isWrapEnabled(): boolean {
    return this.wrapEnabled;
  }

  cycleStreamFilter(): StreamFilter {
    this.streamFilter =
      this.streamFilter === "both"
        ? "stdout"
        : this.streamFilter === "stdout"
          ? "stderr"
          : "both";
    this.anchorEnd = this.totalDisplayRows(0);
    this.refreshMatches();
    return this.streamFilter;
  }

  getStreamFilter(): StreamFilter {
    return this.streamFilter;
  }

  setSearch(query: string): void {
    this.follow = false;
    this.anchorEnd ??= this.totalDisplayRows(0);
    this.searchQuery = query;
    this.refreshMatches();
    if (this.searchMatches.length > 0) {
      this.searchCurrentMatch = this.searchMatches.length - 1;
      this.jumpToVisibleIndex(this.searchMatches[this.searchCurrentMatch] ?? 0);
    } else {
      this.searchCurrentMatch = -1;
    }
  }

  clearSearch(): void {
    this.searchQuery = "";
    this.searchMatches = [];
    this.searchCurrentMatch = -1;
  }

  /**
   * Records a notify log-match marker. Lines whose text equals the matched
   * line are highlighted distinctly from manual search matches and with lower
   * priority (search current match > search match > notify match > stream).
   */
  addNotifyMatch(match: { line: string }): void {
    // Stored as plain visible text so invisible escape bytes cannot be what
    // makes a notification marker match.
    const line = plainTextForDisplay(match.line);
    if (line) this.notifyLines.add(line);
  }

  clearNotifyMatches(): void {
    this.notifyLines.clear();
  }

  getNotifyMatchCount(): number {
    return this.notifyLines.size;
  }

  nextMatch(): void {
    if (this.searchMatches.length === 0) return;
    this.searchCurrentMatch =
      (this.searchCurrentMatch + 1) % this.searchMatches.length;
    this.jumpToVisibleIndex(this.searchMatches[this.searchCurrentMatch] ?? 0);
  }

  previousMatch(): void {
    if (this.searchMatches.length === 0) return;
    this.searchCurrentMatch =
      (this.searchCurrentMatch - 1 + this.searchMatches.length) %
      this.searchMatches.length;
    this.jumpToVisibleIndex(this.searchMatches[this.searchCurrentMatch] ?? 0);
  }

  getSearchInfo(): { query: string; current: number; total: number } | null {
    if (!this.searchQuery) return null;
    return {
      query: this.searchQuery,
      current: this.searchCurrentMatch + 1,
      total: this.searchMatches.length,
    };
  }

  render(width: number, height: number): string[] {
    this.lastRenderWidth = width;
    const visible = this.visibleLines();
    if (visible.length === 0) {
      return this.renderEmpty(width, height);
    }

    if (!this.wrapEnabled) {
      return this.renderTruncated(visible, width, height);
    }

    return this.renderWrapped(visible, width, height);
  }

  private renderTruncated(
    visible: ProcessLogLine[],
    width: number,
    height: number,
  ): string[] {
    if (this.centerTarget !== null) {
      const half = Math.floor(height / 2);
      this.anchorEnd = Math.min(visible.length, this.centerTarget + half + 1);
      this.centerTarget = null;
    }

    const rawEnd = this.follow
      ? visible.length
      : (this.anchorEnd ?? visible.length);
    const end = Math.min(
      visible.length,
      Math.max(Math.min(height, visible.length), rawEnd),
    );
    // Write the clamped end back so the anchor always matches the screen.
    // Otherwise scrolling mutates a stale anchor while the clamp above
    // swallows the change, leaving a dead zone of up to a screenful of
    // scroll keypresses.
    if (!this.follow && this.anchorEnd !== null) this.anchorEnd = end;
    const start = Math.max(0, end - height);
    const matchSet = new Set(this.searchMatches);
    const currentMatchIndex =
      this.searchCurrentMatch >= 0
        ? this.searchMatches[this.searchCurrentMatch]
        : undefined;

    const rendered = visible.slice(start, end).map((line, index) => {
      const visibleIndex = start + index;
      const emphasis: LogLineEmphasis =
        visibleIndex === currentMatchIndex
          ? "search-current"
          : matchSet.has(visibleIndex)
            ? "search"
            : this.notifyLines.has(line.text) ||
                this.notifyLines.has(displayTextOf(line))
              ? "notify"
              : "none";
      return renderLogLine(line, { theme: this.theme, width, emphasis });
    });

    while (rendered.length < height) rendered.unshift("");
    return rendered.slice(-height);
  }

  private renderWrapped(
    visible: ProcessLogLine[],
    width: number,
    height: number,
  ): string[] {
    // Build a flat list of display rows from all visible logical lines.
    // Each entry carries its source logical-line index so emphasis can be
    // applied per logical line (not per wrapped chunk).
    const matchSet = new Set(this.searchMatches);
    const currentMatchIndex =
      this.searchCurrentMatch >= 0
        ? this.searchMatches[this.searchCurrentMatch]
        : undefined;

    const rows: DisplayRow[] = [];
    // Track the starting display-row offset of each logical line so we can
    // resolve centerTarget (a logical-line index) to a display row.
    const logicalToDisplayRow: number[] = [];

    for (let index = 0; index < visible.length; index++) {
      logicalToDisplayRow[index] = rows.length;
      const line = visible[index];
      const emphasis: LogLineEmphasis =
        index === currentMatchIndex
          ? "search-current"
          : matchSet.has(index)
            ? "search"
            : this.notifyLines.has(line.text) ||
                this.notifyLines.has(displayTextOf(line))
              ? "notify"
              : "none";
      const wrapped = renderLogLineWrap(line, {
        theme: this.theme,
        width,
        emphasis,
      });
      for (const text of wrapped) {
        rows.push({ text, logicalIndex: index });
      }
    }

    const totalDisplayRows = rows.length;

    // Resolve centerTarget from logical-line index to display-row index.
    if (this.centerTarget !== null) {
      const half = Math.floor(height / 2);
      const displayRow = logicalToDisplayRow[this.centerTarget] ?? 0;
      this.anchorEnd = Math.min(totalDisplayRows, displayRow + half + 1);
      this.centerTarget = null;
    }

    const rawEnd = this.follow
      ? totalDisplayRows
      : (this.anchorEnd ?? totalDisplayRows);
    const end = Math.min(
      totalDisplayRows,
      Math.max(Math.min(height, totalDisplayRows), rawEnd),
    );
    // Same anchor normalization as the truncated path: keep the stored
    // anchor truthful so scrollBy starts from the rendered bottom edge.
    if (!this.follow && this.anchorEnd !== null) this.anchorEnd = end;
    const start = Math.max(0, end - height);

    const rendered = rows.slice(start, end).map((row) => row.text);

    while (rendered.length < height) rendered.unshift("");
    return rendered.slice(-height);
  }

  getStatusParts(): { left: string[]; right: string[] } {
    const dim = (value: string) => this.theme.fg("dim", value);
    const accent = (value: string) => this.theme.fg("accent", value);
    const error = (value: string) => this.theme.fg("error", value);
    const visible = this.visibleLines();
    const total = this.wrapEnabled ? this.totalDisplayRows(0) : visible.length;

    const left: string[] = [];
    const search = this.getSearchInfo();
    if (search) {
      left.push(
        search.total === 0
          ? error(`no matches: "${search.query}"`)
          : `${dim("/")}${search.query} ${dim(`${search.current}/${search.total}`)}`,
      );
    }

    const right: string[] = [];
    if (this.follow) {
      right.push(accent("following"));
    } else if (total === 0) {
      right.push(dim("empty"));
    } else {
      const end = Math.min(total, Math.max(0, this.anchorEnd ?? total));
      const pct = Math.round((end / total) * 100);
      right.push(dim(`${pct}% L${end}/${total}`));
    }
    if (this.streamFilter !== "both") right.push(dim(`[${this.streamFilter}]`));
    if (this.wrapEnabled) right.push(dim("wrap"));

    return { left, right };
  }

  private renderEmpty(width: number, height: number): string[] {
    const title = this.theme.fg("muted", "No output yet");
    const top = Math.max(0, Math.floor((height - 1) / 2));
    const leftPad = Math.max(0, Math.floor((width - visibleWidth(title)) / 2));
    const lines = Array.from({ length: height }, () => "");
    lines[top] = truncateToWidth(`${" ".repeat(leftPad)}${title}`, width);
    return lines;
  }

  private visibleLines(): ProcessLogLine[] {
    if (this.streamFilter === "both") return this.lines;
    return this.lines.filter((line) => line.type === this.streamFilter);
  }

  /**
   * Total display rows for the visible lines at the last render width.
   * When wrapping is off (or no width is known), equals the logical-line
   * count. The `fallbackWidth` is used before the first render.
   */
  private totalDisplayRows(fallbackWidth: number): number {
    if (!this.wrapEnabled) return this.visibleLines().length;
    const width = this.lastRenderWidth || fallbackWidth;
    if (width <= 0) return this.visibleLines().length;
    let total = 0;
    for (const line of this.visibleLines()) {
      const wrapped = renderLogLineWrap(line, {
        theme: this.theme,
        width,
      });
      total += Math.max(1, wrapped.length);
    }
    return total;
  }

  private refreshMatches(): void {
    if (!this.searchQuery) {
      this.searchMatches = [];
      this.searchCurrentMatch = -1;
      return;
    }

    const query = this.searchQuery.toLowerCase();
    this.searchMatches = this.visibleLines().flatMap((line, index) =>
      line.text.toLowerCase().includes(query) ? [index] : [],
    );
    if (this.searchCurrentMatch >= this.searchMatches.length) {
      this.searchCurrentMatch = Math.max(0, this.searchMatches.length - 1);
    }
  }

  private jumpToVisibleIndex(index: number): void {
    this.follow = false;
    this.centerTarget = index;
  }
}

/**
 * Log lines are untrusted terminal output. Sanitize on ingest so search,
 * notify-match comparison, and rendering all see the same safe text.
 */
function sanitizeLine(line: ProcessLogLine): ProcessLogLine {
  const text = sanitizeForDisplay(line.text);
  return text === line.text ? line : { ...line, text };
}
