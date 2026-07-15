import { describe, expect, it } from "vitest";

import { hasAnsi, stripAnsi } from "./ansi";

const ESC = String.fromCodePoint(0x001b);
const BEL = String.fromCodePoint(0x0007);

describe("stripAnsi", () => {
  it("strips terminal escape sequences", () => {
    const input = [
      `${ESC}[31mred${ESC}[0m`,
      `${ESC}[?25lhidden cursor${ESC}[?25h`,
      `${ESC}[1 qsteady cursor`,
      `${ESC}]0;window title${BEL}text`,
      `${ESC}_cursor marker${BEL}done`,
    ].join(" ");

    expect(stripAnsi(input)).toBe("red hidden cursor steady cursor text done");
    expect(hasAnsi(input)).toBe(true);
  });

  it("strips unsafe controls while preserving tabs and newlines", () => {
    const input = `one${String.fromCodePoint(0)}two${String.fromCodePoint(8)}three\r\nfour\tfive${String.fromCodePoint(0x7f)}`;

    expect(stripAnsi(input)).toBe("onetwothree\nfour\tfive");
  });
});
