import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { displayTextOf, renderLogLine, renderLogLineWrap } from "./log-line";

const ESC = String.fromCodePoint(0x001b);

function makeTheme(): Theme {
  return {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => `[b]${text}[/b]`,
    italic: (text: string) => text,
    underline: (text: string) => `[u]${text}[/u]`,
    inverse: (text: string) => `[inv]${text}[/inv]`,
    strikethrough: (text: string) => text,
  } as unknown as Theme;
}

describe("renderLogLine", () => {
  const theme = makeTheme();

  it("pads to the row width", () => {
    const line = renderLogLine(
      { type: "stdout", text: "hi" },
      {
        theme,
        width: 6,
      },
    );

    expect(line).toBe("hi    ");
  });

  it("sanitizes untrusted output", () => {
    const line = renderLogLine(
      { type: "stdout", text: `${ESC}[2Jwiped\rback` },
      { theme, width: 20 },
    );

    expect(line.trimEnd()).toBe("back");
  });

  it("renders carriage-return progress as the final update", () => {
    const line = renderLogLine(
      {
        type: "stderr",
        text: "\rsynthesized 2/52 \rsynthesized 3/52 \rsynthesized 52/52 ",
      },
      { theme, width: 80 },
    );

    expect(line.startsWith("[warning]synthesized 52/52 ")).toBe(true);
    expect(line).not.toContain("synthesized 2/52");
    expect(line).not.toContain("synthesized 3/52");
  });

  it("keeps colors unless plain is requested", () => {
    const text = `${ESC}[31mred${ESC}[0m`;

    expect(
      renderLogLine({ type: "stdout", text }, { theme, width: 10 }).trimEnd(),
    ).toBe(`${ESC}[31mred${ESC}[0m`);
    expect(
      renderLogLine(
        { type: "stdout", text },
        { theme, width: 10, plain: true },
      ).trimEnd(),
    ).toBe("red");
  });

  it("closes colors that truncation would leave open", () => {
    const line = renderLogLine(
      { type: "stdout", text: `${ESC}[31mred text that keeps going` },
      { theme, width: 8 },
    );

    expect(line.endsWith(`${ESC}[0m`)).toBe(true);
  });

  it("shows a → indicator when a line is truncated", () => {
    const line = renderLogLine(
      { type: "stdout", text: "the quick brown fox jumps over the lazy dog" },
      { theme, width: 10 },
    );

    expect(visibleWidth(line)).toBe(10);
    expect(line).toContain("→");
    // The tail is clipped.
    expect(line).not.toContain("lazy");
  });

  it("does not show → when the line fits", () => {
    const line = renderLogLine(
      { type: "stdout", text: "short" },
      { theme, width: 10 },
    );

    expect(line.trimEnd()).toBe("short");
    expect(line).not.toContain("→");
  });

  it("tones stderr and match state by priority", () => {
    const stderr = renderLogLine(
      { type: "stderr", text: "err" },
      {
        theme,
        width: 3,
      },
    );
    const notify = renderLogLine(
      { type: "stdout", text: "hit" },
      { theme, width: 3, emphasis: "notify" },
    );
    const search = renderLogLine(
      { type: "stderr", text: "hit" },
      { theme, width: 3, emphasis: "search" },
    );
    const current = renderLogLine(
      { type: "stderr", text: "hit" },
      { theme, width: 3, emphasis: "search-current" },
    );

    expect(stderr).toBe("[warning]err[/warning]");
    expect(notify).toBe("[u]hit[/u]");
    expect(search).toBe("[warning]hit[/warning]");
    expect(current).toBe("[b][inv]hit[/inv][/b]");
  });

  it("reserves room for a styled prefix", () => {
    // Real themes emit zero-width ANSI, so the prefix costs its visible cells.
    const prefix = `${ESC}[2msrv │ ${ESC}[0m`;
    const line = renderLogLine(
      { type: "stdout", text: "a much longer log line" },
      { theme, width: 16, prefix },
    );

    expect(line.startsWith(prefix)).toBe(true);
    expect(visibleWidth(line)).toBe(16);
  });

  it("exposes the displayed text for match comparisons", () => {
    expect(displayTextOf({ type: "stdout", text: `${ESC}[2Kready` })).toBe(
      "ready",
    );
    expect(
      displayTextOf({ type: "stdout", text: `${ESC}[31mred${ESC}[0m` }),
    ).toBe("red");
  });
});

describe("renderLogLineWrap", () => {
  const theme = makeTheme();

  it("returns a single padded row for short text", () => {
    const rows = renderLogLineWrap(
      { type: "stdout", text: "hi" },
      { theme, width: 6 },
    );
    expect(rows).toEqual(["hi    "]);
  });

  it("wraps a long line into multiple display rows", () => {
    const rows = renderLogLineWrap(
      { type: "stdout", text: "the quick brown fox jumps" },
      { theme, width: 10 },
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // The first row should not have the continuation prefix.
    expect(rows[0].trimEnd()).toBe("the quick");
    // Continuation rows should have the ↳ prefix (styled by the test theme).
    expect(rows[1]).toContain("↳");
    // The full text should be visible across all rows. Strip styling
    // tags and the continuation prefix to reconstruct the text.
    const combined = rows
      .map((r) =>
        r
          .replace(/\[\/?\w+\]/gu, "")
          .replace(/↳ /gu, "")
          .trimEnd(),
      )
      .join("");
    expect(combined).toContain("the quick");
    expect(combined).toContain("brown");
    expect(combined).toContain("fox");
    expect(combined).toContain("jumps");
  });

  it("tones stderr rows with warning colour", () => {
    const rows = renderLogLineWrap(
      { type: "stderr", text: "error happened here" },
      { theme, width: 10 },
    );
    for (const row of rows) {
      // stderr is toned with [warning]...[/warning]; continuation rows have
      // the dim ↳ prefix before the tone.
      expect(row).toContain("[warning]");
    }
  });

  it("applies search-current emphasis to all wrapped chunks", () => {
    const rows = renderLogLineWrap(
      { type: "stdout", text: "match this long line" },
      { theme, width: 6, emphasis: "search-current" },
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      // search-current is toned with [b][inv]...[/inv][/b]; continuation
      // rows have the dim ↳ prefix before the tone.
      expect(row).toContain("[b]");
      expect(row).toContain("[inv]");
    }
  });

  it("carries SGR colour across wrapped chunks", () => {
    const text = `${ESC}[31mred text that keeps going and going${ESC}[0m`;
    const rows = renderLogLineWrap(
      { type: "stdout", text },
      { theme, width: 10 },
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // First chunk starts with red SGR.
    expect(rows[0].includes(`${ESC}[31m`)).toBe(true);
    // Continuation chunks should also contain the red SGR (re-opened).
    expect(rows[1].includes(`${ESC}[31m`)).toBe(true);
  });

  it("continuation rows have a dim ↳ prefix", () => {
    const rows = renderLogLineWrap(
      { type: "stdout", text: "the quick brown fox jumps" },
      { theme, width: 10 },
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // First row: no continuation prefix.
    expect(rows[0]).not.toContain("↳");
    // Continuation rows: have the dim ↳ prefix.
    for (const row of rows.slice(1)) {
      expect(row).toContain("↳");
    }
  });

  it("returns empty array for zero width", () => {
    expect(
      renderLogLineWrap({ type: "stdout", text: "hi" }, { theme, width: 0 }),
    ).toEqual([]);
  });
});
