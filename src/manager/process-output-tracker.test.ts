import { createMock, type PartialFuncReturn } from "@golevelup/ts-vitest";
import { beforeEach, describe, expect, it } from "vitest";
import type { ManagedProcessRecord } from "./internal-types";
import { ProcessOutputTracker } from "./process-output-tracker";

const managedDefaults = {
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
} satisfies PartialFuncReturn<ManagedProcessRecord>;

describe("ProcessOutputTracker", () => {
  let combinedLines: Array<{
    file: string;
    source: "stdout" | "stderr";
    line: string;
  }>;

  beforeEach(() => {
    combinedLines = [];
  });

  function createTracker(): ProcessOutputTracker {
    return new ProcessOutputTracker({
      appendCombinedLine: (file, source, line) => {
        combinedLines.push({ file, source, line });
      },
    });
  }

  // --- onStdoutChunk / onStderrChunk ---

  describe("chunk processing", () => {
    it("extracts complete stdout lines and appends to combined", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        combinedFile: "/tmp/combined.log",
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from("line1\nline2\n"));

      expect(combinedLines).toEqual([
        { file: "/tmp/combined.log", source: "stdout", line: "line1" },
        { file: "/tmp/combined.log", source: "stdout", line: "line2" },
      ]);
      expect(managed.appendedLines).toEqual([
        { type: "stdout", text: "line1" },
        { type: "stdout", text: "line2" },
      ]);
    });

    it("extracts complete stderr lines and appends to combined", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        combinedFile: "/tmp/combined.log",
        appendedLines: [],
      });

      tracker.onStderrChunk(managed, Buffer.from("error\n"));

      expect(combinedLines).toEqual([
        { file: "/tmp/combined.log", source: "stderr", line: "error" },
      ]);
      expect(managed.appendedLines).toEqual([
        { type: "stderr", text: "error" },
      ]);
    });

    it("handles partial lines across chunks", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from("partial"));
      expect(managed.appendedLines).toEqual([]);

      tracker.onStdoutChunk(managed, Buffer.from(" line\n"));
      expect(managed.appendedLines).toEqual([
        { type: "stdout", text: "partial line" },
      ]);
    });

    it("handles multiple partial lines", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from("a\nb"));
      expect(managed.appendedLines).toEqual([{ type: "stdout", text: "a" }]);

      tracker.onStdoutChunk(managed, Buffer.from("\nc"));
      expect(managed.appendedLines).toEqual([
        { type: "stdout", text: "a" },
        { type: "stdout", text: "b" },
      ]);
      expect(managed.stdoutPendingLine).toBe("c");
    });

    it("keeps stderr pending separate from stdout pending", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from("out_pending"));
      tracker.onStderrChunk(managed, Buffer.from("err_pending"));

      expect(managed.stdoutPendingLine).toBe("out_pending");
      expect(managed.stderrPendingLine).toBe("err_pending");
    });
  });

  // --- flushPendingLines ---

  describe("flushPendingLines", () => {
    it("flushes pending stdout and stderr lines", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        combinedFile: "/tmp/combined.log",
        appendedLines: [],
      });
      managed.stdoutPendingLine = "leftover out";
      managed.stderrPendingLine = "leftover err";

      tracker.flushPendingLines(managed);

      expect(combinedLines).toEqual([
        { file: "/tmp/combined.log", source: "stdout", line: "leftover out" },
        { file: "/tmp/combined.log", source: "stderr", line: "leftover err" },
      ]);
      expect(managed.appendedLines).toEqual([
        { type: "stdout", text: "leftover out" },
        { type: "stderr", text: "leftover err" },
      ]);
      expect(managed.stdoutPendingLine).toBe("");
      expect(managed.stderrPendingLine).toBe("");
    });

    it("is no-op when no pending lines", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        appendedLines: [],
      });

      tracker.flushPendingLines(managed);

      expect(combinedLines).toEqual([]);
      expect(managed.appendedLines).toEqual([]);
    });
  });

  // --- drainAppendedLines ---

  describe("drainAppendedLines", () => {
    it("returns and clears appended lines", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        appendedLines: [],
      });
      managed.appendedLines = [
        { type: "stdout", text: "line1" },
        { type: "stderr", text: "line2" },
      ];

      const drained = tracker.drainAppendedLines(managed);

      expect(drained).toEqual([
        { type: "stdout", text: "line1" },
        { type: "stderr", text: "line2" },
      ]);
      expect(managed.appendedLines).toEqual([]);
    });

    it("returns undefined when no appended lines", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcessRecord>({
        ...managedDefaults,
        appendedLines: [],
      });

      expect(tracker.drainAppendedLines(managed)).toBeUndefined();
    });
  });
});
