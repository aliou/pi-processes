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
    expect(stripAnsi("step 1\rstep 2\b\b done")).toBe("step 1step 2 done");
    expect(stripAnsi("null\u0000byte")).toBe("nullbyte");
    expect(stripAnsi("delete\u007fchar")).toBe("deletechar");
  });

  it("preserves tabs and newlines", () => {
    expect(stripAnsi("one\ttwo\nthree")).toBe("one\ttwo\nthree");
  });
});
