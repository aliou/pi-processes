import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ProcessLogLine } from "../logs-client";

export type StreamFilter = "both" | "stdout" | "stderr";

interface LogFileViewerOptions {
  followEnabled: boolean;
  maxBufferLines: number;
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

  constructor(
    initialLines: ProcessLogLine[],
    private readonly theme: Theme,
    private readonly options: LogFileViewerOptions,
  ) {
    this.follow = options.followEnabled;
    this.lines = initialLines.slice(-options.maxBufferLines);
    this.refreshMatches();
  }

  appendLines(lines: ProcessLogLine[]): void {
    if (lines.length === 0) return;
    this.lines.push(...lines);
    if (this.lines.length > this.options.maxBufferLines) {
      this.lines = this.lines.slice(-this.options.maxBufferLines);
    }
    this.refreshMatches();
    if (this.follow) this.anchorEnd = null;
  }

  scrollBy(delta: number): void {
    const visible = this.visibleLines();
    this.follow = false;
    this.anchorEnd ??= visible.length;
    this.anchorEnd = Math.max(
      0,
      Math.min(visible.length, this.anchorEnd - delta),
    );
  }

  scrollToTop(): void {
    this.follow = false;
    this.anchorEnd = 0;
  }

  scrollToBottom(): void {
    this.follow = false;
    this.anchorEnd = this.visibleLines().length;
  }

  toggleFollow(): boolean {
    this.follow = !this.follow;
    this.anchorEnd = this.follow ? null : this.visibleLines().length;
    return this.follow;
  }

  isFollowing(): boolean {
    return this.follow;
  }

  cycleStreamFilter(): StreamFilter {
    this.streamFilter =
      this.streamFilter === "both"
        ? "stdout"
        : this.streamFilter === "stdout"
          ? "stderr"
          : "both";
    this.anchorEnd = this.visibleLines().length;
    this.refreshMatches();
    return this.streamFilter;
  }

  getStreamFilter(): StreamFilter {
    return this.streamFilter;
  }

  setSearch(query: string): void {
    this.follow = false;
    this.anchorEnd ??= this.visibleLines().length;
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
    const visible = this.visibleLines();
    if (visible.length === 0) {
      return this.renderEmpty(width, height);
    }

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
    const start = Math.max(0, end - height);
    const matchSet = new Set(this.searchMatches);
    const currentMatchIndex =
      this.searchCurrentMatch >= 0
        ? this.searchMatches[this.searchCurrentMatch]
        : undefined;

    const rendered = visible.slice(start, end).map((line, index) => {
      const visibleIndex = start + index;
      const text = truncateToWidth(line.text, width, "", true);
      if (visibleIndex === currentMatchIndex) {
        return truncateToWidth(
          this.theme.bold(this.theme.inverse(text)),
          width,
        );
      }
      if (matchSet.has(visibleIndex)) {
        return truncateToWidth(this.theme.fg("warning", text), width);
      }
      if (line.type === "stderr") {
        return truncateToWidth(this.theme.fg("warning", text), width);
      }
      return truncateToWidth(text, width);
    });

    while (rendered.length < height) rendered.unshift("");
    return rendered.slice(-height);
  }

  getStatusParts(): { left: string[]; right: string[] } {
    const dim = (value: string) => this.theme.fg("dim", value);
    const accent = (value: string) => this.theme.fg("accent", value);
    const error = (value: string) => this.theme.fg("error", value);
    const visible = this.visibleLines();
    const total = visible.length;

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
