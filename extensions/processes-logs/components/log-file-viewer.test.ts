import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { LogFileViewer } from "./log-file-viewer";

function makeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => `[b]${text}[/b]`,
    italic: (text: string) => text,
    underline: (text: string) => `[u]${text}[/u]`,
    inverse: (text: string) => `[inv]${text}[/inv]`,
    strikethrough: (text: string) => text,
  } as unknown as Theme;
}

function trimLines(lines: string[]): string[] {
  return lines.map((line) => line.trimEnd());
}

describe("LogFileViewer", () => {
  it("renders an empty state", () => {
    const viewer = new LogFileViewer([], makeTheme(), {
      followEnabled: false,
      maxBufferLines: 10,
    });

    const lines = viewer.render(20, 5);
    expect(lines).toHaveLength(5);
    expect(lines.join("")).toContain("No output yet");
  });

  it("renders initial lines", () => {
    const viewer = new LogFileViewer(
      [
        { type: "stdout", text: "one" },
        { type: "stdout", text: "two" },
      ],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    const lines = trimLines(viewer.render(20, 5));
    expect(lines).toEqual(["", "", "", "one", "two"]);
  });

  it("appends lines and trims the buffer", () => {
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: "first" }],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 3 },
    );

    viewer.appendLines([
      { type: "stdout", text: "second" },
      { type: "stdout", text: "third" },
      { type: "stdout", text: "fourth" },
    ]);

    const lines = trimLines(viewer.render(20, 5));
    expect(lines).toEqual(["", "", "second", "third", "fourth"]);
  });

  it("trims the buffer by text budget", () => {
    const viewer = new LogFileViewer(
      [
        { type: "stdout", text: "old" },
        { type: "stdout", text: "keep" },
      ],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10, maxBufferBytes: 4 },
    );

    expect(trimLines(viewer.render(20, 3))).toEqual(["", "", "keep"]);
  });

  it("filters by stream", () => {
    const viewer = new LogFileViewer(
      [
        { type: "stdout", text: "out" },
        { type: "stderr", text: "err" },
        { type: "stdout", text: "out2" },
      ],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.cycleStreamFilter();
    expect(viewer.getStreamFilter()).toBe("stdout");
    const stdoutLines = trimLines(viewer.render(20, 5));
    expect(stdoutLines).toContain("out");
    expect(stdoutLines).toContain("out2");
    expect(stdoutLines).not.toContain("err");

    viewer.cycleStreamFilter();
    expect(viewer.getStreamFilter()).toBe("stderr");
    const stderrLines = trimLines(viewer.render(20, 5));
    expect(stderrLines).toContain("err");
    expect(stderrLines).not.toContain("out");
    expect(stderrLines).not.toContain("out2");
  });

  it("supports search navigation", () => {
    const viewer = new LogFileViewer(
      [
        { type: "stdout", text: "one" },
        { type: "stdout", text: "two" },
        { type: "stdout", text: "three" },
      ],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.setSearch("e");
    expect(viewer.getSearchInfo()).toEqual({
      query: "e",
      current: 2,
      total: 2,
    });

    viewer.previousMatch();
    expect(viewer.getSearchInfo()?.current).toBe(1);

    viewer.nextMatch();
    expect(viewer.getSearchInfo()?.current).toBe(2);
  });

  it("toggles follow mode", () => {
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: "line" }],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    expect(viewer.isFollowing()).toBe(false);
    viewer.toggleFollow();
    expect(viewer.isFollowing()).toBe(true);
  });

  it("scrolls relative to the viewport", () => {
    const viewer = new LogFileViewer(
      Array.from({ length: 20 }, (_, i) => ({
        type: "stdout" as const,
        text: `line ${i}`,
      })),
      makeTheme(),
      { followEnabled: true, maxBufferLines: 30 },
    );

    viewer.scrollBy(5);
    expect(viewer.isFollowing()).toBe(false);

    const lines = trimLines(viewer.render(20, 5));
    expect(lines[4]).toBe("line 14");
  });

  it("highlights notify log-match lines with lower priority than search", () => {
    const underline = vi.fn((text: string) => text);
    const theme = {
      ...makeTheme(),
      underline,
    } as unknown as Theme;
    const viewer = new LogFileViewer(
      [
        { type: "stdout", text: "match" },
        { type: "stdout", text: "other" },
      ],
      theme,
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.addNotifyMatch({ line: "match" });
    expect(viewer.getNotifyMatchCount()).toBe(1);

    viewer.render(100, 2);
    // Notify match line is underlined...
    expect(underline).toHaveBeenCalledTimes(1);
    expect(underline.mock.calls[0][0].trim()).toBe("match");
  });

  it("search matches take priority over notify matches", () => {
    const underline = vi.fn((text: string) => text);
    const inverse = vi.fn((text: string) => text);
    const bold = vi.fn((text: string) => text);
    const theme = {
      ...makeTheme(),
      underline,
      inverse,
      bold,
    } as unknown as Theme;
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: "match" }],
      theme,
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.addNotifyMatch({ line: "match" });
    viewer.setSearch("match");

    viewer.render(100, 1);
    // Current search match is bold+inverse, not underline-only.
    expect(inverse).toHaveBeenCalledTimes(1);
    expect(inverse.mock.calls[0][0].trim()).toBe("match");
    expect(bold).toHaveBeenCalled();
    expect(underline).not.toHaveBeenCalled();
  });

  it("neutralizes escape sequences that would corrupt the screen", () => {
    const ESC = String.fromCodePoint(0x1b);
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: `${ESC}[2Jwiped${ESC}[3A` }],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.appendLines([
      { type: "stdout", text: `${ESC}]0;title${String.fromCodePoint(7)}kept` },
      { type: "stdout", text: "over\rwrite" },
      { type: "stdout", text: `${ESC}[31mcolored${ESC}[0m` },
    ]);

    const lines = trimLines(viewer.render(40, 4));
    expect(lines).toEqual([
      "wiped",
      "kept",
      "write",
      `${ESC}[31mcolored${ESC}[0m`,
    ]);
  });

  it("renders carriage-return progress as the final update", () => {
    const viewer = new LogFileViewer(
      [
        {
          type: "stderr",
          text: "\rsynthesized 2/52 \rsynthesized 3/52 \rsynthesized 52/52 ",
        },
      ],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    expect(trimLines(viewer.render(80, 1))).toEqual(["synthesized 52/52"]);
  });

  it("matches notify lines after sanitizing", () => {
    const ESC = String.fromCodePoint(0x1b);
    const underline = vi.fn((text: string) => text);
    const theme = { ...makeTheme(), underline } as unknown as Theme;
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: `${ESC}[2Kready` }],
      theme,
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.addNotifyMatch({ line: `${ESC}[2Kready` });
    viewer.render(40, 1);

    expect(underline).toHaveBeenCalledTimes(1);
  });

  it("matches notify lines by visible text when output is colored", () => {
    const ESC = String.fromCodePoint(0x1b);
    const underline = vi.fn((text: string) => text);
    const theme = { ...makeTheme(), underline } as unknown as Theme;
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: `${ESC}[31mready${ESC}[0m` }],
      theme,
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.addNotifyMatch({ line: "ready" });
    viewer.render(40, 1);

    expect(underline).toHaveBeenCalledTimes(1);
  });

  it("defaults to truncation (no wrap)", () => {
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: "the quick brown fox jumps over the lazy dog" }],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    expect(viewer.isWrapEnabled()).toBe(false);

    const rows = trimLines(viewer.render(10, 1));
    expect(rows).toHaveLength(1);
    // Truncated: the tail is clipped, not wrapped. A → indicator is shown.
    expect(rows[0]).not.toContain("lazy");
    expect(rows[0]).toContain("→");
  });

  it("toggles wrap mode and shows full content across multiple rows", () => {
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: "the quick brown fox jumps over the lazy dog" }],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.toggleWrap();
    expect(viewer.isWrapEnabled()).toBe(true);

    // With width 10, this 43-char line should wrap into multiple rows.
    const rows = viewer.render(10, 10);
    expect(rows.length).toBe(10); // padded to height

    // Skip leading empty padding rows to find the content rows.
    const content = rows.filter((r) => r.trimEnd().length > 0);
    expect(content.length).toBeGreaterThanOrEqual(2);

    // The first content row is the start of the line (no continuation prefix).
    expect(content[0].trimEnd()).toContain("the quick");
    // Continuation rows have the ↳ prefix.
    expect(content[1]).toContain("↳");

    // The full content should be visible somewhere in the rendered rows.
    const combined = content
      .map((r) => r.replace(/↳ /gu, "").trimEnd())
      .join("");
    expect(combined).toContain("the quick");
    expect(combined).toContain("brown");
    expect(combined).toContain("lazy");
    expect(combined).toContain("dog");
  });

  it("wrap mode viewport scrolls by display rows", () => {
    const viewer = new LogFileViewer(
      [
        { type: "stdout", text: "aaaa aaaa aaaa aaaa aaaa" },
        { type: "stdout", text: "bbbb bbbb bbbb bbbb bbbb" },
      ],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.toggleWrap();
    // Each 24-char line wraps to 3 rows at width 10 → 6 total display rows.
    const allRows = trimLines(viewer.render(10, 6));
    expect(allRows).toHaveLength(6);
    expect(allRows[0]).toContain("aaaa");
    expect(allRows[5]).toContain("bbbb");

    // Scroll up by 3 display rows (positive delta = earlier content) to
    // see only the first logical line's wrapped chunks.
    viewer.scrollBy(3);
    const scrolled = trimLines(viewer.render(10, 3));
    expect(scrolled).toHaveLength(3);
    for (const row of scrolled) {
      expect(row).toContain("aaaa");
    }
  });

  it("wrap mode status shows 'wrap' indicator", () => {
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: "short" }],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    const withoutWrap = viewer.getStatusParts();
    expect(withoutWrap.right.join(" ")).not.toContain("wrap");

    viewer.toggleWrap();
    // Need a render first so lastRenderWidth is set.
    viewer.render(20, 5);
    const withWrap = viewer.getStatusParts();
    expect(withWrap.right.join(" ")).toContain("wrap");
  });

  it("wrap mode preserves search match emphasis across wrapped chunks", () => {
    const bold = vi.fn((text: string) => text);
    const inverse = vi.fn((text: string) => text);
    const theme = {
      ...makeTheme(),
      bold,
      inverse,
    } as unknown as Theme;
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: "match this long line that wraps around" }],
      theme,
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.toggleWrap();
    viewer.setSearch("match");

    viewer.render(10, 6);
    // The current search match is bold+inverse; all wrapped chunks of that
    // logical line should be toned.
    expect(inverse).toHaveBeenCalled();
    expect(bold).toHaveBeenCalled();
  });

  it("toggling wrap off returns to truncation", () => {
    const viewer = new LogFileViewer(
      [{ type: "stdout", text: "the quick brown fox jumps over the lazy dog" }],
      makeTheme(),
      { followEnabled: false, maxBufferLines: 10 },
    );

    viewer.toggleWrap();
    expect(viewer.isWrapEnabled()).toBe(true);
    viewer.toggleWrap();
    expect(viewer.isWrapEnabled()).toBe(false);

    const rows = trimLines(viewer.render(10, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toContain("lazy");
    expect(rows[0]).toContain("→");
  });
});
