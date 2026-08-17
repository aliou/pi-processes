import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { truncateToWidth, wrapToWidth } from "./truncate";

const ESC = String.fromCodePoint(0x001b);
const RED = `${ESC}[31m`;
const RESET = `${ESC}[0m`;
const BG = `${ESC}[48;5;236m`;
const BG_OFF = `${ESC}[49m`;

describe("truncateToWidth", () => {
  it("returns short text unchanged and pads on request", () => {
    expect(truncateToWidth("short", 10)).toBe("short");
    expect(truncateToWidth("short", 10, "…", true)).toBe("short     ");
    expect(truncateToWidth("", 4, "…", true)).toBe("    ");
    expect(truncateToWidth("text", 0)).toBe("");
  });

  it("truncates to the requested width including the ellipsis", () => {
    expect(truncateToWidth("way too long line", 10)).toBe("way too l…");
    expect(visibleWidth(truncateToWidth("way too long line", 10))).toBe(10);
    expect(truncateToWidth("way too long line", 10, "")).toBe("way too lo");
  });

  it("never injects a reset, so caller styling survives", () => {
    // A reset here would end the caller's background early and leave the
    // ellipsis and padding unstyled.
    const truncated = truncateToWidth("way too long line here", 14, "…", true);

    expect(truncated).not.toContain(RESET);
    expect(`${BG}${truncated}${BG_OFF}`).toBe(`${BG}way too long …${BG_OFF}`);
  });

  it("keeps the colors of the text it retains", () => {
    expect(truncateToWidth(`${RED}red text that is long${RESET}`, 10)).toBe(
      `${RED}red text …`,
    );
  });

  it("measures wide and zero-width characters by display cells", () => {
    const wide = "日本語テキスト";
    const truncated = truncateToWidth(wide, 8, "…");

    expect(visibleWidth(truncated)).toBeLessThanOrEqual(8);
    expect(truncated).toBe("日本語…");
  });

  it("does not swallow text when a CSI sequence is not an SGR", () => {
    // A parser that scans for the next "m" would eat "hello " here and
    // report the wrong width.
    const text = `${ESC}[2Ahello more text`;

    expect(truncateToWidth(text, 8, "")).toBe(`${ESC}[2Ahello mo`);
  });

  it("pads to the full width when text is truncated", () => {
    expect(truncateToWidth("way too long line", 20, "…", true)).toBe(
      "way too long line   ",
    );
  });
});

describe("wrapToWidth", () => {
  it("returns a single padded row for short text", () => {
    expect(wrapToWidth("hi", 10)).toEqual(["hi        "]);
    expect(wrapToWidth("", 4)).toEqual(["    "]);
  });

  it("wraps a long line into multiple rows", () => {
    const rows = wrapToWidth("the quick brown fox", 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe("the quick ");
    expect(rows[1]).toBe("brown fox ");
    for (const row of rows) {
      expect(visibleWidth(row)).toBe(10);
    }
  });

  it("returns empty array for zero width", () => {
    expect(wrapToWidth("text", 0)).toEqual([]);
  });

  it("wraps ASCII text at exact column boundaries", () => {
    const rows = wrapToWidth("abcdef", 3);
    expect(rows).toEqual(["abc", "def"]);
  });

  it("never splits a wide character across rows", () => {
    // Each CJK char is 2 cells. With width 3, one char (2 cells) fits but
    // two (4 cells) do not, so each row holds one char + 1 space pad.
    const rows = wrapToWidth("\u65e5\u672c\u8a9e", 3);
    expect(rows).toHaveLength(3);
    expect(visibleWidth(rows[0])).toBe(3);
    expect(rows[0]).toBe("\u65e5 ");
    expect(rows[1]).toBe("\u672c ");
    expect(rows[2]).toBe("\u8a9e ");
  });

  it("wraps text with ANSI SGR and carries colour across chunks", () => {
    const rows = wrapToWidth(`${RED}red text that is long${RESET}`, 8);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(visibleWidth(row)).toBe(8);
    }
    // The first chunk should start with the SGR opener.
    expect(rows[0].startsWith(RED)).toBe(true);
    // Every continuation chunk should re-open the colour so it is not lost.
    expect(rows[1].startsWith(RED)).toBe(true);
    // The last chunk should end with a reset.
    expect(rows[rows.length - 1].trimEnd().endsWith(RESET)).toBe(true);
  });

  it("does not re-open colour after a reset mid-string", () => {
    const text = `${RED}red${RESET} normal text here that is long`;
    const rows = wrapToWidth(text, 8);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // The first row starts with RED (it contains the red text + reset).
    expect(rows[0].startsWith(RED)).toBe(true);
    // Continuation rows after the reset should NOT start with RED.
    for (const row of rows.slice(1)) {
      expect(row.startsWith(RED)).toBe(false);
    }
  });

  it("expands tabs to 3 columns when wrapping", () => {
    // A tab is 3 cells; with width 6 the tab + "ab" (5 cells) fits on row 1,
    // and the remaining text wraps to row 2.
    const rows = wrapToWidth("\tabcdef", 6);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(visibleWidth(row)).toBe(6);
    }
  });

  it("handles a mix of ANSI, wide chars, and tabs", () => {
    const text = `${RED}\u65e5\u672c\ttext${RESET} more stuff here`;
    const rows = wrapToWidth(text, 6);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(visibleWidth(row)).toBe(6);
    }
    // No row should contain a partial surrogate pair.
    for (const row of rows) {
      expect(row).not.toMatch(/[\uD800-\uDBFF]$/u);
    }
  });

  it("pads every row to the full width", () => {
    const rows = wrapToWidth("short", 10);
    expect(rows).toEqual(["short     "]);
  });

  it("narrows continuation rows when contIndent is set", () => {
    // With contIndent=2, first row gets 10 cells, continuation rows get 8.
    const rows = wrapToWidth("the quick brown fox jumps", 10, 2);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(visibleWidth(rows[0])).toBe(10);
    // Continuation rows are narrower (8 cells of text content).
    for (const row of rows.slice(1)) {
      expect(visibleWidth(row)).toBe(8);
    }
  });

  it("contIndent=0 wraps all rows to the same width", () => {
    const rows = wrapToWidth("the quick brown fox jumps", 10, 0);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(visibleWidth(row)).toBe(10);
    }
  });
});
