import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi";

describe("stripAnsi", () => {
  it("strips CSI styling sequences", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });

  it("strips generic OSC sequences", () => {
    expect(stripAnsi("\u001b]0;title\u0007hello")).toBe("hello");
  });

  it("strips carriage returns and other control chars that can corrupt TUI rendering", () => {
    const output = stripAnsi("step 1\rstep 2\b\b done");
    expect(output).toBe("step 1step 2 done");
    for (const char of output) {
      const code = char.codePointAt(0) ?? 0;
      const isDisallowedC0 =
        (code >= 0x00 && code <= 0x08) ||
        (code >= 0x0b && code <= 0x1f) ||
        code === 0x7f;
      expect(isDisallowedC0).toBe(false);
    }
  });
});
