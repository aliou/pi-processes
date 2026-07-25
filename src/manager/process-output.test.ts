import { createMock, type PartialFuncReturn } from "@golevelup/ts-vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerEvent } from "../types";
import type { ManagedProcessRecord } from "./internal-types";
import {
  MAX_LINE_BYTES,
  MAX_LINES_PER_EMIT,
  MAX_PENDING_LINE_BYTES,
  TRUNCATION_SUFFIX,
} from "./limits";
import type { ProcessLogStore } from "./process-log-store";
import { ProcessOutput } from "./process-output";

const recordDefaults = {
  id: "proc_1",
  name: "test",
  pid: 1234,
  command: "echo hi",
  cwd: "/tmp",
  startTime: 0,
  endTime: null,
  status: "running",
  exitCode: null,
  success: null,
  stdoutFile: "/tmp/stdout.log",
  stderrFile: "/tmp/stderr.log",
  endReason: null,
  signal: null,
  errorMessage: null,
  combinedFile: "/tmp/combined.log",
  stdin: null,
  stdinClosed: false,
  lastSignalSent: null,
  stdoutPendingLine: Buffer.alloc(0),
  stderrPendingLine: Buffer.alloc(0),
  stdoutLineOverflowed: false,
  stderrLineOverflowed: false,
  appendedLines: [],
  droppedLineCount: 0,
} satisfies PartialFuncReturn<ManagedProcessRecord>;

describe("ProcessOutput", () => {
  let combinedLines: Array<{
    file: string;
    source: "stdout" | "stderr";
    line: string;
  }>;
  let emitted: ManagerEvent[];

  beforeEach(() => {
    combinedLines = [];
    emitted = [];
  });

  function createOutput(throttleMs = 100): ProcessOutput {
    const logStore = createMock<ProcessLogStore>({
      appendCombinedLine: (file, source, line) => {
        combinedLines.push({ file, source, line });
      },
    });

    return new ProcessOutput({
      emit: (event) => emitted.push(event),
      logStore,
      throttleMs,
    });
  }

  function createRecord(
    overrides: Partial<ManagedProcessRecord> = {},
  ): ManagedProcessRecord {
    return createMock<ManagedProcessRecord>({
      ...recordDefaults,
      appendedLines: [],
      ...overrides,
    });
  }

  it("extracts complete stdout lines, appends combined output, and emits appended text", () => {
    using output = createOutput();
    const record = createRecord();

    output.onStdoutChunk(record, Buffer.from("line1\nline2\n"));

    expect(combinedLines).toEqual([
      { file: "/tmp/combined.log", source: "stdout", line: "line1" },
      { file: "/tmp/combined.log", source: "stdout", line: "line2" },
    ]);
    expect(emitted).toEqual([
      {
        type: "process_output_changed",
        id: "proc_1",
        appendedText: [
          { type: "stdout", text: "line1" },
          { type: "stdout", text: "line2" },
        ],
      },
    ]);
    expect(record.appendedLines).toEqual([]);
  });

  it("extracts complete stderr lines", () => {
    using output = createOutput();
    const record = createRecord();

    output.onStderrChunk(record, Buffer.from("error\n"));

    expect(combinedLines).toEqual([
      { file: "/tmp/combined.log", source: "stderr", line: "error" },
    ]);
    expect(emitted[0]).toEqual({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: [{ type: "stderr", text: "error" }],
    });
  });

  it("keeps partial lines until a later chunk completes them", () => {
    using output = createOutput();
    const record = createRecord();

    output.onStdoutChunk(record, Buffer.from("partial"));
    expect(combinedLines).toEqual([]);
    expect(record.stdoutPendingLine.toString()).toBe("partial");
    expect(emitted).toEqual([{ type: "process_output_changed", id: "proc_1" }]);

    output.onStdoutChunk(record, Buffer.from(" done\nnext"));

    expect(combinedLines).toEqual([
      { file: "/tmp/combined.log", source: "stdout", line: "partial done" },
    ]);
    expect(record.stdoutPendingLine.toString()).toBe("next");
  });

  it("flushes pending stdout and stderr lines", () => {
    using output = createOutput();
    const record = createRecord({
      stdoutPendingLine: Buffer.from("stdout tail"),
      stderrPendingLine: Buffer.from("stderr tail"),
    });

    output.flush(record);

    expect(combinedLines).toEqual([
      { file: "/tmp/combined.log", source: "stdout", line: "stdout tail" },
      { file: "/tmp/combined.log", source: "stderr", line: "stderr tail" },
    ]);
    expect(record.stdoutPendingLine).toHaveLength(0);
    expect(record.stderrPendingLine).toHaveLength(0);
    expect(record.stdoutLineOverflowed).toBe(false);
    expect(record.stderrLineOverflowed).toBe(false);
    expect(emitted).toEqual([
      {
        type: "process_output_changed",
        id: "proc_1",
        appendedText: [
          { type: "stdout", text: "stdout tail" },
          { type: "stderr", text: "stderr tail" },
        ],
      },
    ]);
  });

  it("throttles rapid output events", () => {
    vi.useFakeTimers();
    using output = createOutput(100);
    const record = createRecord();

    output.onStdoutChunk(record, Buffer.from("line1\n"));
    expect(emitted).toHaveLength(1);

    output.onStdoutChunk(record, Buffer.from("line2\n"));
    expect(emitted).toHaveLength(1);

    vi.advanceTimersByTime(150);

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: [{ type: "stdout", text: "line2" }],
    });

    vi.useRealTimers();
  });

  it("flush sends pending throttled output immediately", () => {
    vi.useFakeTimers();
    using output = createOutput(100);
    const record = createRecord();

    output.onStdoutChunk(record, Buffer.from("line1\n"));
    output.onStdoutChunk(record, Buffer.from("line2\n"));

    output.flush(record);

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: [{ type: "stdout", text: "line2" }],
    });

    vi.useRealTimers();
  });

  it("caps buffered lines after adding final partial output during flush", () => {
    using output = createOutput(100);
    const record = createRecord({
      appendedLines: Array.from({ length: MAX_LINES_PER_EMIT }, (_, index) => ({
        type: "stdout" as const,
        text: `line-${index}`,
      })),
      stdoutPendingLine: Buffer.from("final tail"),
    });

    output.flush(record);

    const event = emitted[0];
    expect(event).toMatchObject({
      type: "process_output_changed",
      droppedLines: 1,
    });
    if (event?.type !== "process_output_changed") return;
    expect(event.appendedText).toHaveLength(MAX_LINES_PER_EMIT);
    expect(event.appendedText?.[0]?.text).toBe("line-1");
    expect(event.appendedText?.at(-1)?.text).toBe("final tail");
  });

  it("clear removes pending timers", () => {
    vi.useFakeTimers();
    using output = createOutput(100);
    const record = createRecord();

    output.onStdoutChunk(record, Buffer.from("line1\n"));
    output.onStdoutChunk(record, Buffer.from("line2\n"));
    output.clear(record.id);

    vi.advanceTimersByTime(150);

    expect(emitted).toHaveLength(1);

    vi.useRealTimers();
  });

  it("emits one bounded line and drops the remainder until newline", () => {
    using output = createOutput(0);
    const record = createRecord();
    const chunks = ["a".repeat(40_000), "b".repeat(40_000), "c".repeat(40_000)];

    const lines = chunks.flatMap((chunk) =>
      output.onStdoutChunk(record, Buffer.from(chunk)),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBeLessThanOrEqual(
      MAX_PENDING_LINE_BYTES + TRUNCATION_SUFFIX.length,
    );
    expect(lines[0]?.endsWith(TRUNCATION_SUFFIX)).toBe(true);
    expect(record.stdoutLineOverflowed).toBe(true);

    expect(output.onStdoutChunk(record, Buffer.from("tail\nafter\n"))).toEqual([
      "after",
    ]);
  });

  it("truncates a complete overlong line and keeps following lines", () => {
    using output = createOutput(0);
    const record = createRecord();

    const lines = output.onStdoutChunk(
      record,
      Buffer.from(`${"a".repeat(100_000)}\nshort\n`),
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]?.endsWith(TRUNCATION_SUFFIX)).toBe(true);
    expect(lines[1]).toBe("short");
  });

  it("handles CRLF split across chunks", () => {
    using output = createOutput(0);
    const record = createRecord();

    output.onStdoutChunk(record, Buffer.from("line\r"));
    const lines = output.onStdoutChunk(record, Buffer.from("\nnext\r\n"));

    expect(lines).toEqual(["line", "next"]);
  });

  it("enforces byte limits without splitting UTF-8 characters", () => {
    using output = createOutput(0);
    const record = createRecord();

    const lines = output.onStdoutChunk(
      record,
      Buffer.from(`${"€".repeat(30_000)}\n`),
    );

    expect(Buffer.byteLength(lines[0] ?? "")).toBeLessThanOrEqual(
      MAX_PENDING_LINE_BYTES + Buffer.byteLength(TRUNCATION_SUFFIX),
    );
    const event = emitted[0];
    if (event?.type !== "process_output_changed") return;
    expect(
      Buffer.byteLength(event.appendedText?.[0]?.text ?? ""),
    ).toBeLessThanOrEqual(MAX_LINE_BYTES);
    expect(event.appendedText?.[0]?.text).not.toContain("�");
  });

  it("caps an output burst and reports the newest retained lines", () => {
    vi.useFakeTimers();
    using output = createOutput(100);
    const record = createRecord();

    output.onStdoutChunk(record, Buffer.from("initial\n"));
    const lines = Array.from(
      { length: MAX_LINES_PER_EMIT + 500 },
      (_, index) => `line-${index}`,
    );
    output.onStdoutChunk(record, Buffer.from(`${lines.join("\n")}\n`));
    vi.advanceTimersByTime(100);

    const event = emitted.at(-1);
    expect(event).toMatchObject({
      type: "process_output_changed",
      droppedLines: 500,
    });
    if (event?.type !== "process_output_changed") return;
    expect(event.appendedText).toHaveLength(MAX_LINES_PER_EMIT);
    expect(event.appendedText?.[0]?.text).toBe("line-500");
    expect(event.appendedText?.at(-1)?.text).toBe(
      `line-${MAX_LINES_PER_EMIT + 499}`,
    );

    vi.useRealTimers();
  });

  it("clamps event lines while preserving the longer combined-log line", () => {
    using output = createOutput(0);
    const record = createRecord();

    output.onStdoutChunk(record, Buffer.from(`${"x".repeat(100_000)}\n`));

    expect(combinedLines[0]?.line.length).toBeGreaterThan(MAX_LINE_BYTES);
    const event = emitted[0];
    if (event?.type !== "process_output_changed") return;
    expect(Buffer.byteLength(event.appendedText?.[0]?.text ?? "")).toBe(
      MAX_LINE_BYTES,
    );
    expect(event.appendedText?.[0]?.text.endsWith(TRUNCATION_SUFFIX)).toBe(
      true,
    );
  });
});
