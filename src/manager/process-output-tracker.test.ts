import { createMock, type PartialFuncReturn } from "@golevelup/ts-vitest";
import { beforeEach, describe, expect, it } from "vitest";
import type { ManagerEvent } from "../types";
import type { ManagedProcess } from "./internal-types";
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
  alertOnSuccess: false,
  alertOnFailure: true,
  alertOnKill: false,
  stdin: null,
  stdinClosed: false,
  lastSignalSent: null,
  stdoutPendingLine: "",
  stderrPendingLine: "",
} satisfies PartialFuncReturn<ManagedProcess>;

describe("ProcessOutputTracker", () => {
  let emitted: ManagerEvent[];
  let combinedLines: Array<{
    file: string;
    source: "stdout" | "stderr";
    line: string;
  }>;

  beforeEach(() => {
    emitted = [];
    combinedLines = [];
  });

  function createTracker(): ProcessOutputTracker {
    return new ProcessOutputTracker({
      emit: (event) => emitted.push(event),
      appendCombinedLine: (file, source, line) => {
        combinedLines.push({ file, source, line });
      },
    });
  }

  // --- resolveLogWatches ---

  describe("resolveLogWatches", () => {
    it("returns empty array for no input", () => {
      using tracker = createTracker();
      expect(tracker.resolveLogWatches()).toEqual([]);
      expect(tracker.resolveLogWatches([])).toEqual([]);
    });

    it("resolves a valid watch", () => {
      using tracker = createTracker();
      const watches = tracker.resolveLogWatches([{ pattern: "ready" }]);

      expect(watches).toHaveLength(1);
      expect(watches[0]).toEqual(
        expect.objectContaining({
          index: 0,
          pattern: "ready",
          mode: "literal",
          stream: "both",
          repeat: false,
          fired: false,
        }),
      );
      expect(watches[0].regex).toBeInstanceOf(RegExp);
    });

    it("respects stream and repeat options", () => {
      using tracker = createTracker();
      const watches = tracker.resolveLogWatches([
        { pattern: "err", stream: "stderr", repeat: true },
      ]);

      expect(watches[0]).toEqual(
        expect.objectContaining({
          mode: "literal",
          stream: "stderr",
          repeat: true,
        }),
      );
    });

    it("escapes literal watches by default", () => {
      using tracker = createTracker();
      const watches = tracker.resolveLogWatches([{ pattern: "(" }]);

      expect(watches[0].regex.test("(")).toBe(true);
    });

    it("supports explicit regex watches", () => {
      using tracker = createTracker();
      const watches = tracker.resolveLogWatches([
        { pattern: "r.*y", mode: "regex" },
      ]);

      expect(watches[0]).toEqual(
        expect.objectContaining({ mode: "regex", pattern: "r.*y" }),
      );
      expect(watches[0].regex.test("ready")).toBe(true);
    });

    it("throws for empty pattern", () => {
      using tracker = createTracker();
      expect(() => tracker.resolveLogWatches([{ pattern: "" }])).toThrow(
        /pattern is required/,
      );
    });

    it("throws for whitespace-only pattern", () => {
      using tracker = createTracker();
      expect(() => tracker.resolveLogWatches([{ pattern: "  " }])).toThrow(
        /pattern is required/,
      );
    });

    it("throws for invalid regex", () => {
      using tracker = createTracker();
      expect(() =>
        tracker.resolveLogWatches([{ pattern: "(", mode: "regex" }]),
      ).toThrow(/Invalid log watch pattern/);
    });

    it("throws for invalid mode", () => {
      using tracker = createTracker();
      expect(() =>
        tracker.resolveLogWatches([
          { pattern: "ok", mode: "invalid" as never },
        ]),
      ).toThrow(/Invalid logWatches.*mode/);
    });

    it("throws for invalid stream", () => {
      using tracker = createTracker();
      expect(() =>
        tracker.resolveLogWatches([
          { pattern: "ok", stream: "invalid" as never },
        ]),
      ).toThrow(/Invalid logWatches.*stream/);
    });

    it("throws when too many watches are configured", () => {
      using tracker = createTracker();
      expect(() =>
        tracker.resolveLogWatches(
          Array.from({ length: 21 }, () => ({ pattern: "ok" })),
        ),
      ).toThrow(/at most 20/);
    });

    it("throws when a watch pattern is too long", () => {
      using tracker = createTracker();
      expect(() =>
        tracker.resolveLogWatches([{ pattern: "x".repeat(501) }]),
      ).toThrow(/500 characters/);
    });
  });

  // --- onStdoutChunk / onStderrChunk ---

  describe("chunk processing", () => {
    it("extracts complete stdout lines and appends to combined", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        combinedFile: "/tmp/combined.log",
        watches: [],
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
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        combinedFile: "/tmp/combined.log",
        watches: [],
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
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: [],
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
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: [],
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
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: [],
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
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        combinedFile: "/tmp/combined.log",
        watches: [],
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
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: [],
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
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: [],
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
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: [],
        appendedLines: [],
      });

      expect(tracker.drainAppendedLines(managed)).toBeUndefined();
    });
  });

  // --- matchWatches ---

  describe("watch matching", () => {
    it("fires watch event on matching stdout line", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        id: "p1",
        name: "test",
        command: "cmd",
        watches: tracker.resolveLogWatches([{ pattern: "ready" }]),
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from("ready\n"));

      expect(emitted).toEqual([
        expect.objectContaining({
          type: "process_watch_matched",
        }),
      ]);
      if (emitted[0].type === "process_watch_matched") {
        expect(emitted[0].match).toEqual(
          expect.objectContaining({
            processId: "p1",
            source: "stdout",
            line: "ready",
          }),
        );
      }
    });

    it("fires only once by default (no repeat)", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: tracker.resolveLogWatches([{ pattern: "go" }]),
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from("go\ngo\ngo\n"));

      const matches = emitted.filter((e) => e.type === "process_watch_matched");
      expect(matches).toHaveLength(1);
    });

    it("fires multiple times with repeat=true", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: tracker.resolveLogWatches([{ pattern: "go", repeat: true }]),
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from("go\ngo\ngo\n"));

      const matches = emitted.filter((e) => e.type === "process_watch_matched");
      expect(matches).toHaveLength(3);
    });

    it("respects stream scoping (stderr only)", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: tracker.resolveLogWatches([
          { pattern: "err", stream: "stderr" },
        ]),
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from("err\n"));
      tracker.onStderrChunk(managed, Buffer.from("err\n"));

      const matches = emitted.filter((e) => e.type === "process_watch_matched");
      expect(matches).toHaveLength(1);
      if (matches[0].type === "process_watch_matched") {
        expect(matches[0].match.source).toBe("stderr");
      }
    });

    it("does not run watch matching against oversized lines", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: tracker.resolveLogWatches([{ pattern: "needle" }]),
        appendedLines: [],
      });

      tracker.onStdoutChunk(managed, Buffer.from(`${"x".repeat(10_001)}\n`));

      const matches = emitted.filter((e) => e.type === "process_watch_matched");
      expect(matches).toHaveLength(0);
    });

    it("flushPendingLines triggers watches on trailing partial", () => {
      using tracker = createTracker();
      const managed = createMock<ManagedProcess>({
        ...managedDefaults,
        watches: tracker.resolveLogWatches([{ pattern: "partial" }]),
        appendedLines: [],
      });
      managed.stdoutPendingLine = "partial data";

      tracker.flushPendingLines(managed);

      const matches = emitted.filter((e) => e.type === "process_watch_matched");
      expect(matches).toHaveLength(1);
    });
  });
});
