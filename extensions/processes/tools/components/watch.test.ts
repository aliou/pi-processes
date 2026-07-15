import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { buildMatcherLine, formatPatternForDisplay } from "./watch";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

describe("watch rendering", () => {
  it("renders matcher control characters visibly", () => {
    const line = buildMatcherLine(
      {
        pattern: 'ERROR\nretry\t"quoted"',
        mode: "regex",
        stream: "stderr",
        repeat: true,
        on: "context",
      },
      theme,
    );

    expect(line.render(200).map((rendered) => rendered.trimEnd())).toEqual([
      '[stderr] regex  context (repeat)  ERROR\\nretry\\t"quoted"',
    ]);
  });

  it("preserves quotes while rendering control characters visibly", () => {
    expect(
      formatPatternForDisplay(
        `ready|"started"\nnext\tstep${String.fromCharCode(27)}[31m`,
      ),
    ).toBe('ready|"started"\\nnext\\tstep\\x1b[31m');
  });

  it("uses distinct tones for attention and pattern", () => {
    const taggedTheme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => `<bold>${text}</bold>`,
    } as Theme;

    const line = buildMatcherLine(
      { pattern: "ready", on: "context" },
      taggedTheme,
    )
      .render(200)[0]
      .trimEnd();

    expect(line).toContain(
      "<bold><success>context</success></bold>  <accent>ready</accent>",
    );
  });
});
