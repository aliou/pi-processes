import { describe, expect, it } from "vitest";

import { compileLogMatchers, evaluateLogMatchers } from "./log-matchers";

describe("compileLogMatchers", () => {
  it("returns empty array when no logMatches in config", () => {
    expect(compileLogMatchers({})).toEqual([]);
    expect(compileLogMatchers({ onSuccess: "turn" })).toEqual([]);
  });

  it("compiles literal matcher with defaults", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready" }],
    });

    expect(matchers).toHaveLength(1);
    expect(matchers[0]).toMatchObject({
      pattern: "ready",
      mode: "literal",
      stream: "both",
      repeat: false,
      on: "turn",
      lineMatcher: expect.any(Function),
      matcherIndex: 0,
      fired: false,
      lastMatchTime: 0,
    });
  });

  it("compiles regex matcher", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "error:\\d+", mode: "regex" }],
    });

    expect(matchers).toHaveLength(1);
    expect(matchers[0].mode).toBe("regex");
    expect(matchers[0].lineMatcher).toBeTypeOf("function");
  });

  it("skips invalid regex patterns", () => {
    const matchers = compileLogMatchers({
      logMatches: [
        { pattern: "valid", mode: "regex" },
        { pattern: "[invalid", mode: "regex" },
        { pattern: "also-valid", mode: "regex" },
      ],
    });

    expect(matchers).toHaveLength(2);
    expect(matchers[0].pattern).toBe("valid");
    expect(matchers[1].pattern).toBe("also-valid");
  });

  it("respects custom stream and repeat settings", () => {
    const matchers = compileLogMatchers({
      logMatches: [
        { pattern: "err", stream: "stderr", repeat: true, on: "context" },
      ],
    });

    expect(matchers[0]).toMatchObject({
      stream: "stderr",
      repeat: true,
      on: "context",
    });
  });

  it("limits matchers to MAX_MATCHERS_PER_PROCESS (20)", () => {
    const logMatches = Array.from({ length: 25 }, (_, i) => ({
      pattern: `pattern-${i}`,
    }));

    const matchers = compileLogMatchers({ logMatches });
    expect(matchers).toHaveLength(20);
  });

  it("skips patterns exceeding MAX_PATTERN_LENGTH (500)", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "a".repeat(501) }, { pattern: "short" }],
    });

    expect(matchers).toHaveLength(1);
    expect(matchers[0].pattern).toBe("short");
  });
});

describe("evaluateLogMatchers", () => {
  it("matches literal pattern in appended text", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready" }],
    });

    const results = evaluateLogMatchers(
      matchers,
      [{ type: "stdout", text: "Server is ready on port 3000" }],
      1000,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      pattern: "ready",
      mode: "literal",
      stream: "stdout",
      on: "turn",
    });
  });

  it("matches regex pattern in appended text", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "error:\\d+", mode: "regex" }],
    });

    const results = evaluateLogMatchers(
      matchers,
      [{ type: "stderr", text: "error:42 something broke" }],
      1000,
    );

    expect(results).toHaveLength(1);
    expect(results[0].mode).toBe("regex");
  });

  it("respects stream filter", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "error", stream: "stderr" }],
    });

    // Pattern in stdout should not match when stream is stderr-only
    const stdoutResults = evaluateLogMatchers(
      matchers,
      [{ type: "stdout" as const, text: "error happened" }],
      1000,
    );
    expect(stdoutResults).toHaveLength(0);

    // Reset matcher state
    matchers[0].fired = false;

    const stderrResults = evaluateLogMatchers(
      matchers,
      [{ type: "stderr" as const, text: "error happened" }],
      1000,
    );
    expect(stderrResults).toHaveLength(1);
  });

  it("one-shot matcher fires only once", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready", repeat: false }],
    });

    const appended = [{ type: "stdout" as const, text: "ready" }];

    const results1 = evaluateLogMatchers(matchers, appended, 1000);
    expect(results1).toHaveLength(1);

    const results2 = evaluateLogMatchers(matchers, appended, 2000);
    expect(results2).toHaveLength(0);
  });

  it("repeat matcher fires multiple times respecting cooldown", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready", repeat: true }],
    });

    const appended = [{ type: "stdout" as const, text: "ready" }];

    // First match at t=1000
    const results1 = evaluateLogMatchers(matchers, appended, 1000);
    expect(results1).toHaveLength(1);

    // Second match at t=2000 (within 15s cooldown) - should not fire
    const results2 = evaluateLogMatchers(matchers, appended, 2000);
    expect(results2).toHaveLength(0);

    // Third match at t=16000 (after 15s cooldown) - should fire
    const results3 = evaluateLogMatchers(matchers, appended, 16_000);
    expect(results3).toHaveLength(1);
  });

  it("enforces repeat cooldown when the first match occurs at zero", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready", repeat: true }],
    });
    const appended = [{ type: "stdout" as const, text: "ready" }];

    expect(evaluateLogMatchers(matchers, appended, 0)).toHaveLength(1);
    expect(evaluateLogMatchers(matchers, appended, 1)).toHaveLength(0);
  });

  it("returns no results for empty appended text", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready" }],
    });

    expect(evaluateLogMatchers(matchers, [], 1000)).toHaveLength(0);
  });

  it("splits appended text into lines and skips empty lines", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready" }],
    });

    const results = evaluateLogMatchers(
      matchers,
      [{ type: "stdout", text: "building...\n\nready\n" }],
      1000,
    );

    expect(results).toHaveLength(1);
    expect(results[0].line).toBe("ready");
  });

  it("skips lines exceeding MAX_LINE_LENGTH", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready" }],
    });

    const longLine = `${"x".repeat(10_001)}ready`;
    const results = evaluateLogMatchers(
      matchers,
      [{ type: "stdout", text: longLine }],
      1000,
    );

    expect(results).toHaveLength(0);
  });

  it("matches across multiple appended entries", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "ready" }],
    });

    const results = evaluateLogMatchers(
      matchers,
      [
        { type: "stdout", text: "building..." },
        { type: "stdout", text: "ready" },
      ],
      1000,
    );

    expect(results).toHaveLength(1);
  });

  it("matches carriage-return progress against the displayed final update", () => {
    const matchers = compileLogMatchers({
      logMatches: [
        { pattern: "synthesized 2/52" },
        { pattern: "synthesized 52/52" },
      ],
    });

    const results = evaluateLogMatchers(
      matchers,
      [
        {
          type: "stderr",
          text: "\rsynthesized 2/52 \rsynthesized 3/52 \rsynthesized 52/52 ",
        },
      ],
      1000,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      pattern: "synthesized 52/52",
      line: "synthesized 52/52 ",
    });
  });

  it("does not match text hidden inside dropped escape payloads", () => {
    const ESC = String.fromCodePoint(0x1b);
    const BEL = String.fromCodePoint(0x07);
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "hidden" }, { pattern: "visible" }],
    });

    const results = evaluateLogMatchers(
      matchers,
      [{ type: "stdout", text: `${ESC}]0;hidden${BEL}visible` }],
      1000,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      pattern: "visible",
      line: "visible",
    });
  });

  it("does not match invisible SGR styling bytes", () => {
    const ESC = String.fromCodePoint(0x1b);
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "31m" }, { pattern: "red" }],
    });

    const results = evaluateLogMatchers(
      matchers,
      [{ type: "stdout", text: `${ESC}[31mred${ESC}[0m` }],
      1000,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ pattern: "red", line: "red" });
  });

  it("supports both stream matching", () => {
    const matchers = compileLogMatchers({
      logMatches: [{ pattern: "warn", stream: "both" }],
    });

    const results = evaluateLogMatchers(
      matchers,
      [
        { type: "stdout" as const, text: "warning: something" },
        { type: "stderr" as const, text: "warn: another thing" },
      ],
      1000,
    );

    // Should match the first matching line (stdout)
    expect(results).toHaveLength(1);
    expect(results[0].stream).toBe("stdout");
  });
});
