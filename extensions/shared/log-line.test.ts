import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { displayTextOf, renderLogLine } from "./log-line";

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

    expect(line.trimEnd()).toBe("wipedback");
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
  });
});
