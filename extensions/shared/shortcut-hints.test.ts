import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderShortcutHints, type ShortcutHint } from "./shortcut-hints";

/**
 * Theme fake that emits real ANSI escapes so `visibleWidth` sees the same
 * widths the renderer does while assertions can still match exact styles.
 */
const ESC = String.fromCharCode(27);
const ANSI_CODES: Record<string, string> = { dim: "2", accent: "36" };
const theme = {
  fg: (color: string, text: string) =>
    `${ESC}[${ANSI_CODES[color] ?? "0"}m${text}${ESC}[0m`,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => `${ESC}[1m${text}${ESC}[22m`,
} as unknown as Theme;

const DIM = (text: string) => `${ESC}[2m${text}${ESC}[0m`;
const ACCENT = (text: string) => `${ESC}[36m${text}${ESC}[0m`;
const BOLD = (text: string) => `${ESC}[1m${text}${ESC}[22m`;

/** The renderer pads to the requested width; drop that padding for exact asserts. */
function unpad(line: string): string {
  return line.replace(/ +$/, "");
}

/** Width generous enough that a single hint never overflows. */
const SINGLE_HINT_WIDTH = 40;

/** Render one hint alone, wide enough to avoid the ? more collapse. */
function renderHint(hint: ShortcutHint): string {
  return unpad(renderShortcutHints([hint], theme, SINGLE_HINT_WIDTH));
}

describe("shortcut hint rendering", () => {
  it("renders minimal form when the single-char key occurs in the word", () => {
    expect(renderHint({ key: "w", label: "wrap" })).toBe(
      `${ACCENT(BOLD("w"))}rap`,
    );
  });

  it("keeps the classic form for keys not contained in the word", () => {
    expect(renderHint({ key: "q", label: "close" })).toBe(`${DIM("q")} close`);
  });

  it("keeps the classic form for multi-char keys", () => {
    expect(renderHint({ key: "j/k", label: "scroll" })).toBe(
      `${DIM("j/k")} scroll`,
    );
  });

  it("keeps the classic form for non-word keys", () => {
    expect(renderHint({ key: "/", label: "search" })).toBe(
      `${DIM("/")} search`,
    );
  });

  it("matches the key case-sensitively (N prev stays classic)", () => {
    expect(renderHint({ key: "N", label: "prev" })).toBe(`${DIM("N")} prev`);
    expect(renderHint({ key: "n", label: "next" })).toBe(
      `${ACCENT(BOLD("n"))}ext`,
    );
  });

  it("applies segment styles to the non-key remainder in minimal form", () => {
    expect(
      renderHint({ key: "w", label: [{ text: "wrap", style: "accent" }] }),
    ).toBe(`${ACCENT(BOLD("w"))}${ACCENT("rap")}`);
    expect(
      renderHint({ key: "w", label: [{ text: "wrap", style: "dim" }] }),
    ).toBe(`${ACCENT(BOLD("w"))}${DIM("rap")}`);
  });

  it("highlights every occurrence of the key across segments", () => {
    const hint: ShortcutHint = {
      key: "s",
      label: [
        { text: "stdout", style: "accent" },
        { text: "+", style: "dim" },
        { text: "stderr", style: "dim" },
      ],
    };
    expect(renderHint(hint)).toBe(
      `${ACCENT(BOLD("s"))}${ACCENT("tdout")}${DIM("+")}${ACCENT(BOLD("s"))}${DIM("tderr")}`,
    );
  });

  it("renders styled segments in classic form too", () => {
    const hint: ShortcutHint = {
      key: "x",
      label: [
        { text: "a", style: "dim" },
        { text: "b", style: "accent" },
        { text: "c" },
      ],
    };
    expect(renderHint(hint)).toBe(`${DIM("x")} ${DIM("a")}${ACCENT("b")}c`);
  });
});

describe("renderShortcutHints", () => {
  const WRAP_HINT = { key: "w", label: "wrap" } as const;
  const SCROLL_HINT = { key: "j/k", label: "scroll" } as const;
  const CLOSE_HINT = { key: "q", label: "close" } as const;
  const hints: ShortcutHint[] = [WRAP_HINT, SCROLL_HINT, CLOSE_HINT];

  const WRAP_WIDTH = "wrap".length;
  const SCROLL_HINT_WIDTH = "j/k scroll".length;
  const CLOSE_HINT_WIDTH = "q close".length;
  const MORE_WIDTH = "? more".length;
  const SEPARATOR_WIDTH = 2;

  it("joins all hints when the list fits", () => {
    expect(unpad(renderShortcutHints(hints, theme, 100))).toBe(
      `${ACCENT(BOLD("w"))}rap  ${DIM("j/k")} scroll  ${DIM("q")} close`,
    );
  });

  it("prefixes the ? affordance and keeps the hints that fit", () => {
    const fitsWrapAndScroll =
      MORE_WIDTH +
      SEPARATOR_WIDTH +
      WRAP_WIDTH +
      SEPARATOR_WIDTH +
      SCROLL_HINT_WIDTH;
    expect(unpad(renderShortcutHints(hints, theme, fitsWrapAndScroll))).toBe(
      `${ACCENT(BOLD("?"))}${DIM(" more")}  ${ACCENT(BOLD("w"))}rap  ${DIM("j/k")} scroll`,
    );
    // One column less and "j/k scroll" no longer fits.
    expect(
      unpad(renderShortcutHints(hints, theme, fitsWrapAndScroll - 1)),
    ).toBe(`${ACCENT(BOLD("?"))}${DIM(" more")}  ${ACCENT(BOLD("w"))}rap`);
  });

  it("shows only the ? affordance when nothing else fits", () => {
    expect(unpad(renderShortcutHints(hints, theme, CLOSE_HINT_WIDTH))).toBe(
      `${ACCENT(BOLD("?"))}${DIM(" more")}`,
    );
  });

  it("never exceeds the requested width", () => {
    for (let width = 1; width <= 40; width += 1) {
      const line = renderShortcutHints(hints, theme, width);
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});
