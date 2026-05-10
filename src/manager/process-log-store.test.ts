import { fs, vol } from "memfs";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs");
vi.mock("node:fs/promises");

import { ProcessLogStore } from "./process-log-store";

describe("ProcessLogStore", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("uses a unique default log directory", () => {
    using first = new ProcessLogStore();
    using second = new ProcessLogStore();

    expect(first.getLogDir()).not.toEqual(second.getLogDir());
  });

  it("creates log files on createLogs", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    expect(paths).toEqual({
      stdoutFile: "/tmp/test-logs/proc_1-stdout.log",
      stderrFile: "/tmp/test-logs/proc_1-stderr.log",
      combinedFile: "/tmp/test-logs/proc_1-combined.log",
    });

    expect(fs.existsSync(paths.stdoutFile)).toBe(true);
    expect(fs.existsSync(paths.stderrFile)).toBe(true);
    expect(fs.existsSync(paths.combinedFile)).toBe(true);
  });

  it("appends stdout data", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    store.appendStdout(paths.stdoutFile, Buffer.from("hello\n"));

    const content = fs.readFileSync(paths.stdoutFile, "utf-8");
    expect(content).toBe("hello\n");
  });

  it("appends stderr data", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    store.appendStderr(paths.stderrFile, Buffer.from("error\n"));

    const content = fs.readFileSync(paths.stderrFile, "utf-8");
    expect(content).toBe("error\n");
  });

  it("appends combined lines with stream tag", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    store.appendCombinedLine(paths.combinedFile, "stdout", "out line");
    store.appendCombinedLine(paths.combinedFile, "stderr", "err line");

    const content = fs.readFileSync(paths.combinedFile, "utf-8");
    expect(content).toBe("1:out line\n2:err line\n");
  });

  it("appends error lines", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    store.appendErrorLine(paths.stderrFile, "Spawn error: missing pid");

    const content = fs.readFileSync(paths.stderrFile, "utf-8");
    expect(content).toBe("Spawn error: missing pid\n");
  });

  it("readTailLines returns last N lines", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "line1\nline2\nline3\nline4\nline5\n");

    expect(store.readTailLines(paths.stdoutFile, 3)).toEqual([
      "line3",
      "line4",
      "line5",
    ]);
  });

  it("readTailLines returns all lines when fewer than N", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "only\nline\n");

    expect(store.readTailLines(paths.stdoutFile, 10)).toEqual(["only", "line"]);
  });

  it("readTailLines returns empty array for missing file", () => {
    using store = new ProcessLogStore("/tmp/test-logs");

    expect(store.readTailLines("/nonexistent", 10)).toEqual([]);
  });

  it("readFullFile returns entire content", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "full content here");

    expect(store.readFullFile(paths.stdoutFile)).toBe("full content here");
  });

  it("readFullFile returns empty string for missing file", () => {
    using store = new ProcessLogStore("/tmp/test-logs");

    expect(store.readFullFile("/nonexistent")).toBe("");
  });

  it("getCombinedOutput parses tagged lines", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(
      paths.combinedFile,
      "1:stdout line\n2:stderr line\n1:another out\n",
    );

    expect(store.getCombinedOutput(paths.combinedFile, 100)).toEqual([
      { type: "stdout", text: "stdout line" },
      { type: "stderr", text: "stderr line" },
      { type: "stdout", text: "another out" },
    ]);
  });

  it("getFileSize returns file sizes", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "12345");
    fs.writeFileSync(paths.stderrFile, "abc");

    expect(store.getFileSize(paths)).toEqual({ stdout: 5, stderr: 3 });
  });

  it("getFileSize returns zeros for missing files", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = {
      stdoutFile: "/nonexistent-stdout",
      stderrFile: "/nonexistent-stderr",
      combinedFile: "/nonexistent-combined",
    };

    expect(store.getFileSize(paths)).toEqual({ stdout: 0, stderr: 0 });
  });

  it("removeLogs deletes log files", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "data");
    fs.writeFileSync(paths.stderrFile, "data");
    fs.writeFileSync(paths.combinedFile, "data");

    assert(
      fs.existsSync(paths.stdoutFile) &&
        fs.existsSync(paths.stderrFile) &&
        fs.existsSync(paths.combinedFile),
      "files should exist before removal",
    );

    store.removeLogs(paths);

    expect(fs.existsSync(paths.stdoutFile)).toBe(false);
    expect(fs.existsSync(paths.stderrFile)).toBe(false);
    expect(fs.existsSync(paths.combinedFile)).toBe(false);
  });

  it("cleanup removes log directory", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    store.createLogs("proc_1");

    assert(
      fs.existsSync("/tmp/test-logs"),
      "log dir should exist before cleanup",
    );

    store.cleanup();

    expect(fs.existsSync("/tmp/test-logs")).toBe(false);
  });
});
