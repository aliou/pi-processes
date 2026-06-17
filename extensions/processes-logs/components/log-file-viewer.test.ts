import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { LogFileViewer } from "./log-file-viewer";

function makeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => `[b]${text}[/b]`,
    italic: (text: string) => text,
    underline: (text: string) => text,
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
});
