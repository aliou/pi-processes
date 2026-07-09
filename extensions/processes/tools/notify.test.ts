import { describe, expect, it } from "vitest";

import { normalizeNotifyConfig } from "./notify";

describe("normalizeNotifyConfig", () => {
  it("applies lifecycle defaults", () => {
    expect(normalizeNotifyConfig(undefined)).toEqual({
      onSuccess: "context",
      onFailure: "turn",
      onKilled: "context",
      logMatches: [],
    });
  });

  it("normalizes a literal matcher with defaults", () => {
    expect(
      normalizeNotifyConfig({
        logMatches: [{ pattern: "ready" }],
      }),
    ).toEqual({
      onSuccess: "context",
      onFailure: "turn",
      onKilled: "context",
      logMatches: [
        {
          pattern: "ready",
          mode: "literal",
          stream: "both",
          repeat: false,
          on: "turn",
        },
      ],
    });
  });

  it("normalizes a regex matcher", () => {
    expect(
      normalizeNotifyConfig({
        onSuccess: "turn",
        onFailure: "context",
        onKilled: "turn",
        logMatches: [
          {
            pattern: "ready on port \\d+",
            mode: "regex",
            stream: "stdout",
            repeat: true,
            on: "context",
          },
        ],
      }),
    ).toEqual({
      onSuccess: "turn",
      onFailure: "context",
      onKilled: "turn",
      logMatches: [
        {
          pattern: "ready on port \\d+",
          mode: "regex",
          stream: "stdout",
          repeat: true,
          on: "context",
        },
      ],
    });
  });

  it("rejects invalid regex patterns", () => {
    expect(() =>
      normalizeNotifyConfig({
        logMatches: [{ pattern: "[invalid", mode: "regex" }],
      }),
    ).toThrow(
      /notify\.logMatches\[0\]\.pattern is not a valid regular expression/,
    );
  });

  it("rejects too many log matchers", () => {
    expect(() =>
      normalizeNotifyConfig({
        logMatches: Array.from({ length: 21 }, (_, index) => ({
          pattern: `pattern-${index}`,
        })),
      }),
    ).toThrow(/supports at most 20 matchers/);
  });

  it("rejects patterns over 500 characters", () => {
    expect(() =>
      normalizeNotifyConfig({
        logMatches: [{ pattern: "a".repeat(501) }],
      }),
    ).toThrow(/pattern must be at most 500 characters/);
  });

  it.each([
    ["onSuccess", { onSuccess: "bad" }],
    ["onFailure", { onFailure: "bad" }],
    ["onKilled", { onKilled: "bad" }],
    ["log match attention", { logMatches: [{ pattern: "x", on: "bad" }] }],
  ])("rejects invalid attention for %s", (_label, notify) => {
    expect(() => normalizeNotifyConfig(notify)).toThrow(
      /must be one of: turn, context, ignore/,
    );
  });

  it("rejects invalid log match stream", () => {
    expect(() =>
      normalizeNotifyConfig({
        logMatches: [{ pattern: "x", stream: "combined" }],
      }),
    ).toThrow(
      /notify\.logMatches\[0\]\.stream must be one of: stdout, stderr, both/,
    );
  });

  it("rejects invalid log match mode", () => {
    expect(() =>
      normalizeNotifyConfig({
        logMatches: [{ pattern: "x", mode: "glob" }],
      }),
    ).toThrow(/notify\.logMatches\[0\]\.mode must be one of: literal, regex/);
  });
});
