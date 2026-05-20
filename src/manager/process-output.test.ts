import { createMock, type PartialFuncReturn } from "@golevelup/ts-vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerEvent } from "../types";
import type { ManagedProcessRecord } from "./internal-types";
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
  combinedFile: "/tmp/combined.log",
  stdin: null,
  stdinClosed: false,
  lastSignalSent: null,
  stdoutPendingLine: "",
  stderrPendingLine: "",
  appendedLines: [],
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
    expect(record.stdoutPendingLine).toBe("partial");
    expect(emitted).toEqual([{ type: "process_output_changed", id: "proc_1" }]);

    output.onStdoutChunk(record, Buffer.from(" done\nnext"));

    expect(combinedLines).toEqual([
      { file: "/tmp/combined.log", source: "stdout", line: "partial done" },
    ]);
    expect(record.stdoutPendingLine).toBe("next");
  });

  it("flushes pending stdout and stderr lines", () => {
    using output = createOutput();
    const record = createRecord({
      stdoutPendingLine: "stdout tail",
      stderrPendingLine: "stderr tail",
    });

    output.flush(record);

    expect(combinedLines).toEqual([
      { file: "/tmp/combined.log", source: "stdout", line: "stdout tail" },
      { file: "/tmp/combined.log", source: "stderr", line: "stderr tail" },
    ]);
    expect(record.stdoutPendingLine).toBe("");
    expect(record.stderrPendingLine).toBe("");
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
});
