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
      '[stderr] regex  context (repeat)  /ERROR\\nretry\\t"quoted"/',
    ]);
  });

  it("preserves quotes while rendering control characters visibly", () => {
    expect(
      formatPatternForDisplay(
        `ready|"started"\nnext\tstep${String.fromCharCode(27)}[31m`,
      ),
    ).toBe('ready|"started"\\nnext\\tstep\\x1b[31m');
  });

  it("wraps literal patterns in double quotes and regex in slashes", () => {
    const literal = buildMatcherLine(
      { pattern: "ready", mode: "literal" },
      theme,
    )
      .render(200)[0]
      .trimEnd();
    expect(literal).toContain('"ready"');

    const regex = buildMatcherLine({ pattern: "err.*", mode: "regex" }, theme)
      .render(200)[0]
      .trimEnd();
    expect(regex).toContain("/err.*/");
  });

  it("wraps a literal pattern containing a double quote in single quotes", () => {
    const line = buildMatcherLine(
      { pattern: 'say "hi"', mode: "literal" },
      theme,
    )
      .render(200)[0]
      .trimEnd();
    expect(line).toContain(`'say "hi"'`);
    expect(line).not.toContain('"say');
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
      '<bold><success>context</success></bold>  <accent>"ready"</accent>',
    );
  });
});
