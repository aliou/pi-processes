import { describe, expect, it } from "vitest";

import { normalizeNotifyConfig } from "./notify";

describe("normalizeNotifyConfig", () => {
  it("applies lifecycle defaults", () => {
    expect(normalizeNotifyConfig(undefined)).toEqual({
      onSuccess: "turn",
      onFailure: "turn",
      onKilled: "context",
      logMatches: [],
    });
  });

  it("defaults onSuccess to turn so a finished process wakes an idle agent", () => {
    expect(normalizeNotifyConfig({}).onSuccess).toBe("turn");
  });

  it("still allows opting out of a success turn", () => {
    expect(normalizeNotifyConfig({ onSuccess: "context" }).onSuccess).toBe(
      "context",
    );
  });

  it("normalizes a literal matcher with defaults", () => {
    expect(
      normalizeNotifyConfig({
        logMatches: [{ pattern: "ready" }],
      }),
    ).toEqual({
      onSuccess: "turn",
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

  it("rejects empty log-match patterns", () => {
    expect(() =>
      normalizeNotifyConfig({
        logMatches: [{ pattern: "" }],
      }),
    ).toThrow(/pattern must not be empty or whitespace-only/);
  });

  it("rejects whitespace-only log-match patterns", () => {
    expect(() =>
      normalizeNotifyConfig({
        logMatches: [{ pattern: "   \t " }],
      }),
    ).toThrow(/pattern must not be empty or whitespace-only/);
  });

  // Enum validation (attention, stream, mode) is covered by the tool's
  // TypeBox schema: Pi validates tool call arguments before execute, so
  // invalid values never reach normalizeNotifyConfig.
});
