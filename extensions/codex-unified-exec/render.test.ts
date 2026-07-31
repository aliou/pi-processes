import { describe, expect, it } from "vitest";

import { formatOutputOmissionMarker } from "./constants";
import {
  type ExecCommandOutput,
  formatCodeModeResult,
  formatResponseText,
  modelOutputMaxTokens,
} from "./render";

const marker = (n: number) => formatOutputOmissionMarker(n);

describe("modelOutputMaxTokens", () => {
  it("uses the explicit override when provided", () => {
    expect(
      modelOutputMaxTokens({ maxOutputTokens: 7 } as ExecCommandOutput),
    ).toBe(7);
  });

  it("falls back to the codex default of 10000", () => {
    expect(
      modelOutputMaxTokens({ maxOutputTokens: undefined } as ExecCommandOutput),
    ).toBe(10000);
  });

  it("clamps an explicit value above the codex output ceiling", () => {
    // UNIFIED_EXEC_OUTPUT_MAX_TOKENS = 1 MiB / 4 = 262144.
    expect(
      modelOutputMaxTokens({ maxOutputTokens: 1_000_000 } as ExecCommandOutput),
    ).toBe(262_144);
  });
});

describe("formatResponseText", () => {
  it("renders a finished command (exit code, no session, no omission)", () => {
    const out: ExecCommandOutput = {
      chunkId: "abc123",
      wallTimeMs: 1500,
      rawOutput: Buffer.from("hello", "utf8"),
      maxOutputTokens: undefined,
      processId: null,
      exitCode: 0,
      originalTokenCount: 2,
      outputOmittedBytes: null,
    };
    expect(formatResponseText(out)).toBe(
      [
        "Chunk ID: abc123",
        "Wall time: 1.5000 seconds",
        "Process exited with code 0",
        "Original token count: 2",
        "Output:",
        "hello",
      ].join("\n"),
    );
  });

  it("renders a running session (session id) and preserves the omission marker", () => {
    const raw = Buffer.from(`head\n${marker(5)}\ntail`, "utf8");
    const out: ExecCommandOutput = {
      chunkId: "c1",
      wallTimeMs: 250,
      rawOutput: raw,
      maxOutputTokens: undefined,
      processId: 42,
      exitCode: null,
      originalTokenCount: 10,
      outputOmittedBytes: 5,
    };
    expect(formatResponseText(out)).toBe(
      [
        "Chunk ID: c1",
        "Wall time: 0.2500 seconds",
        "Process running with session ID 42",
        "Original token count: 10",
        "Output:",
        `head\n${marker(5)}\ntail`,
      ].join("\n"),
    );
  });

  it("suppresses the Chunk ID line when the chunk id is empty", () => {
    const out: ExecCommandOutput = {
      chunkId: "",
      wallTimeMs: 1,
      rawOutput: Buffer.from("x", "utf8"),
      maxOutputTokens: undefined,
      processId: null,
      exitCode: 1,
      originalTokenCount: 0,
      outputOmittedBytes: null,
    };
    const text = formatResponseText(out);
    expect(text.startsWith("Chunk ID:")).toBe(false);
    expect(text).toContain("Process exited with code 1");
  });
});

describe("formatCodeModeResult", () => {
  it("only includes optional fields when they are present", () => {
    const finished: ExecCommandOutput = {
      chunkId: "abc123",
      wallTimeMs: 1500,
      rawOutput: Buffer.from("hello", "utf8"),
      maxOutputTokens: undefined,
      processId: null,
      exitCode: 0,
      originalTokenCount: 2,
      outputOmittedBytes: null,
    };
    expect(formatCodeModeResult(finished)).toEqual({
      chunk_id: "abc123",
      wall_time_seconds: 1.5,
      exit_code: 0,
      original_token_count: 2,
      output: "hello",
    });

    const running: ExecCommandOutput = {
      chunkId: "c1",
      wallTimeMs: 250,
      rawOutput: Buffer.from(`head\n${marker(5)}\ntail`, "utf8"),
      maxOutputTokens: undefined,
      processId: 42,
      exitCode: null,
      originalTokenCount: 10,
      outputOmittedBytes: 5,
    };
    expect(formatCodeModeResult(running)).toEqual({
      chunk_id: "c1",
      wall_time_seconds: 0.25,
      session_id: 42,
      original_token_count: 10,
      output: `head\n${marker(5)}\ntail`,
    });
  });
});
