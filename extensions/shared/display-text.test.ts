import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  plainTextForDisplay,
  sanitizeForDisplay,
  truncateForDisplay,
} from "./display-text";

const ESC = String.fromCodePoint(0x001b);
const BEL = String.fromCodePoint(0x0007);

describe("sanitizeForDisplay", () => {
  const RESET = `${ESC}[0m`;

  it("keeps SGR color sequences", () => {
    expect(sanitizeForDisplay(`${ESC}[31mred${ESC}[0m plain`)).toBe(
      `${ESC}[31mred${ESC}[0m plain${RESET}`,
    );
    expect(sanitizeForDisplay(`${ESC}[38;5;204mfancy${ESC}[0m`)).toBe(
      `${ESC}[38;5;204mfancy${ESC}[0m`,
    );
  });

  it("returns plain text untouched", () => {
    expect(sanitizeForDisplay("just text")).toBe("just text");
  });

  it("expands tabs to 8-column stops", () => {
    expect(sanitizeForDisplay("ab\tc")).toBe("ab      c");
    expect(sanitizeForDisplay("\tx")).toBe("        x");
    expect(sanitizeForDisplay(`ab${ESC}[31m\tc`)).toBe(
      `ab${ESC}[31m      c${RESET}`,
    );
  });

  it("expands tabs by terminal cell width, not character count", () => {
    // "世界" is 4 cells wide, so the tab must advance to column 8.
    expect(sanitizeForDisplay("世界\tx")).toBe("世界    x");
    // An astral character is 2 UTF-16 code units but 2 cells.
    const astral = String.fromCodePoint(0x1f642);
    expect(sanitizeForDisplay(`${astral}\tx`)).toBe(`${astral}      x`);
  });

  it("recognizes the C1 string terminator", () => {
    const C1_ST = String.fromCodePoint(0x9c);
    expect(sanitizeForDisplay(`${ESC}]0;title${C1_ST}kept`)).toBe("kept");
    expect(sanitizeForDisplay(`${ESC}Pdata${C1_ST}kept`)).toBe("kept");
  });

  it("drops C1 string payloads before applying carriage returns", () => {
    const C1_OSC = String.fromCodePoint(0x9d);
    expect(sanitizeForDisplay(`old${C1_OSC}0;ti\rtle${BEL}new`)).toBe("oldnew");
  });

  it("treats BEL inside a DCS payload as data, not a terminator", () => {
    expect(sanitizeForDisplay(`${ESC}Pq${BEL}payload${ESC}\\kept`)).toBe(
      "kept",
    );
  });

  it("drops newlines so one log line stays one row", () => {
    expect(sanitizeForDisplay("one\ntwo")).toBe("onetwo");
  });

  it.each([
    ["cursor up", `${ESC}[2Ahello more text`, "hello more text"],
    ["erase screen", `${ESC}[2Jboom`, "boom"],
    ["erase line", `${ESC}[2K${ESC}[1Gprogress`, "progress"],
    ["alternate screen", `${ESC}[?1049hgone`, "gone"],
    ["scroll region", `${ESC}[1;5rzz`, "zz"],
    ["cursor position", `${ESC}[10;10Hhere`, "here"],
    ["cursor style", `${ESC}[1 qsteady`, "steady"],
    ["window title", `${ESC}]0;pwned${BEL}rest`, "rest"],
    ["apc", `${ESC}_marker${BEL}done`, "done"],
    ["dcs", `${ESC}Pq#0;2;0;0;0${ESC}\\tail`, "tail"],
    ["terminal reset", `${ESC}csurvived`, "survived"],
    ["charset designator", `${ESC}(0lqk`, "lqk"],
    ["carriage return", "progress 10%\rprogress 99%", "progress 99%"],
    ["backspace", "abc\b\b\bxyz", "abcxyz"],
    ["bell", "ding\u0007ding", "dingding"],
    ["c1 csi", `${String.fromCodePoint(0x9b)}2Jboom`, "2Jboom"],
  ])("neutralizes %s", (_name, input, expected) => {
    expect(sanitizeForDisplay(input)).toBe(expected);
  });

  it("shows the final carriage-return progress update", () => {
    expect(
      sanitizeForDisplay(
        "\rsynthesized 2/52 \rsynthesized 3/52 \rsynthesized 52/52 ",
      ),
    ).toBe("synthesized 52/52 ");
  });

  it("ignores carriage returns inside dropped escape payloads", () => {
    expect(sanitizeForDisplay(`old${ESC}]0;ti\rtle${BEL}new`)).toBe("oldnew");
  });

  it("drops unterminated sequences along with their payload", () => {
    expect(sanitizeForDisplay(`ok ${ESC}]0;no terminator here`)).toBe("ok ");
    expect(sanitizeForDisplay(`ok ${ESC}[38;5`)).toBe("ok ");
    expect(sanitizeForDisplay(`ok ${ESC}`)).toBe("ok ");
  });

  it("does not keep private-mode sequences that end in m", () => {
    expect(sanitizeForDisplay(`${ESC}[?1000mtext`)).toBe("text");
  });

  it("leaves no escape characters other than SGR", () => {
    const nasty = `${ESC}[31mred${ESC}[2J${ESC}]0;x${BEL}\rmore${ESC}[1A`;
    const output = sanitizeForDisplay(nasty);

    expect(output).toBe("more");
    const sgr = new RegExp(`${ESC}\\[[0-9;:]*m`, "gu");
    expect(output.match(sgr)).toBeNull();
    expect(output.split(ESC)).toHaveLength(1);
  });

  it("returns plain visible text for comparisons", () => {
    expect(
      plainTextForDisplay(`${ESC}[31mred${ESC}[0m\rover${ESC}]0;hidden${BEL}`),
    ).toBe("over");
  });
});

describe("truncateForDisplay", () => {
  it("fits wide characters into the requested cells", () => {
    const cmd = "日本語のコマンドをここに書きます";

    expect(visibleWidth(truncateForDisplay(cmd, 12))).toBeLessThanOrEqual(12);
    expect(truncateForDisplay(cmd, 12)).toBe("日本語のコ…");
  });

  it("never cuts a grapheme in half", () => {
    const emoji = String.fromCodePoint(0x1f642).repeat(8);
    const truncated = truncateForDisplay(`run ${emoji}`, 12);

    expect(visibleWidth(truncated)).toBeLessThanOrEqual(12);
    expect(truncated).not.toMatch(/[\uD800-\uDBFF]$/u);
  });

  it("sanitizes escape sequences in labels", () => {
    expect(truncateForDisplay(`echo ${ESC}[2Jboom`, 20)).toBe("echo boom");
  });

  it("leaves short labels alone", () => {
    expect(truncateForDisplay("pnpm dev", 12)).toBe("pnpm dev");
  });
});
