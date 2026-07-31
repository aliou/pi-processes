import { describe, expect, it } from "vitest";

import {
  approxBytesForTokens,
  approxTokenCount,
  approxTokensFromByteCount,
  byteBudget,
  formattedTruncateText,
  truncateText,
} from "./truncation";

describe("approxTokenCount / byte estimates", () => {
  it("treats 4 bytes as ~1 token", () => {
    expect(approxBytesForTokens(10)).toBe(40);
    expect(approxTokensFromByteCount(0)).toBe(0);
    expect(approxTokensFromByteCount(1)).toBe(1);
    expect(approxTokensFromByteCount(4)).toBe(1);
    expect(approxTokensFromByteCount(5)).toBe(2);
    expect(approxTokenCount("a")).toBe(1);
    expect(approxTokenCount("abcd")).toBe(1);
    expect(approxTokenCount("abcde")).toBe(2);
  });

  it("byteBudget maps token policies through the 4-byte estimate", () => {
    expect(byteBudget({ type: "bytes", bytes: 100 })).toBe(100);
    expect(byteBudget({ type: "tokens", tokens: 10 })).toBe(40);
  });
});

describe("truncateText (middle truncation)", () => {
  it("keeps a prefix and suffix and inserts a chars-truncated marker", () => {
    expect(truncateText("0123456789", { type: "bytes", bytes: 4 })).toBe(
      "01…6 chars truncated…89",
    );
  });

  it("reports removed units as tokens under a token policy", () => {
    // 1 token ~= 4 bytes; keeping 4 bytes drops 6 bytes ~= 2 tokens
    expect(truncateText("0123456789", { type: "tokens", tokens: 1 })).toBe(
      "01…2 tokens truncated…89",
    );
  });

  it("returns content unchanged when it fits the budget", () => {
    expect(truncateText("ab", { type: "bytes", bytes: 4 })).toBe("ab");
    expect(truncateText("ab", { type: "tokens", tokens: 1 })).toBe("ab");
  });

  it("splits on UTF-8 boundaries, never inside a multibyte char", () => {
    // "a日b" = [0x61, 0xE6,0x97,0xA5, 0x62] (5 bytes). Keep 1 + 1 bytes -> "a" + "b".
    expect(truncateText("a日b", { type: "bytes", bytes: 2 })).toBe(
      "a…1 chars truncated…b",
    );
  });
});

describe("formattedTruncateText", () => {
  it("is a passthrough when the content fits the budget", () => {
    expect(formattedTruncateText("ab", { type: "bytes", bytes: 10 })).toBe(
      "ab",
    );
  });

  it("wraps the middle-truncated result with original token count + line count", () => {
    expect(
      formattedTruncateText("0123456789", { type: "bytes", bytes: 4 }),
    ).toBe(
      "Warning: truncated output (original token count: 3)\nTotal output lines: 1\n\n01…6 chars truncated…89",
    );
  });
});
