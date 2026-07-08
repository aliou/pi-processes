import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import {
  executeOutput,
  formatOutputDetails,
  type OutputDetails,
} from "./index";

function mockManager(
  output: {
    stdout: string[];
    stderr: string[];
    status: string;
  } | null,
): ProcessManager {
  const process: ProcessInfo = {
    id: "proc_1",
    name: "server",
    pid: 12345,
    command: "npm start",
    cwd: "/project",
    startTime: 1000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/proc_1.stdout.log",
    stderrFile: "/tmp/proc_1.stderr.log",
    endReason: null,
    signal: null,
    errorMessage: null,
  };

  return {
    get: vi.fn().mockReturnValue(process),
    getOutput: vi.fn().mockReturnValue(output),
  } as unknown as ProcessManager;
}

describe("executeOutput", () => {
  it("throws if id is missing", () => {
    const manager = mockManager(null);
    expect(() => executeOutput({ action: "output" } as never, manager)).toThrow(
      "process output requires id",
    );
  });

  it("throws if process not found", () => {
    const manager = {
      get: vi.fn().mockReturnValue(null),
    } as unknown as ProcessManager;

    expect(() =>
      executeOutput({ action: "output", id: "bad_id" } as never, manager),
    ).toThrow("process not found: bad_id");
  });

  it("throws if output is null", () => {
    const manager = mockManager(null);
    expect(() =>
      executeOutput({ action: "output", id: "proc_1" } as never, manager),
    ).toThrow('could not read output for "server" (proc_1)');
  });

  it("returns both streams by default", () => {
    const manager = mockManager({
      stdout: ["line 1", "line 2"],
      stderr: ["err 1"],
      status: "running",
    });

    const result = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(result.action).toBe("output");
    expect(result.stream).toBe("both");
    expect(result.stdout).toEqual(["line 1", "line 2"]);
    expect(result.stderr).toEqual(["err 1"]);
    expect(result.pattern).toBeNull();
    expect(result.mode).toBe("literal");
    expect(result.tailLines).toBe(100);
  });

  it("filters to stdout only", () => {
    const manager = mockManager({
      stdout: ["out"],
      stderr: ["err"],
      status: "running",
    });

    const result = executeOutput(
      { action: "output", id: "proc_1", stream: "stdout" } as never,
      manager,
    );

    expect(result.stdout).toEqual(["out"]);
    expect(result.stderr).toEqual([]);
  });

  it("filters to stderr only", () => {
    const manager = mockManager({
      stdout: ["out"],
      stderr: ["err"],
      status: "running",
    });

    const result = executeOutput(
      { action: "output", id: "proc_1", stream: "stderr" } as never,
      manager,
    );

    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual(["err"]);
  });

  it("applies literal pattern filter", () => {
    const manager = mockManager({
      stdout: ["error: crash", "info: ok", "error: fail"],
      stderr: [],
      status: "running",
    });

    const result = executeOutput(
      { action: "output", id: "proc_1", pattern: "error" } as never,
      manager,
    );

    expect(result.stdout).toEqual(["error: crash", "error: fail"]);
    expect(result.stderr).toEqual([]);
    expect(result.pattern).toBe("error");
    expect(result.mode).toBe("literal");
  });

  it("applies regex pattern filter", () => {
    const manager = mockManager({
      stdout: ["ERR404", "INFO ok", "ERR500"],
      stderr: [],
      status: "running",
    });

    const result = executeOutput(
      {
        action: "output",
        id: "proc_1",
        pattern: "ERR\\d+",
        mode: "regex",
      } as never,
      manager,
    );

    expect(result.stdout).toEqual(["ERR404", "ERR500"]);
  });

  it("throws on invalid regex", () => {
    const manager = mockManager({
      stdout: [],
      stderr: [],
      status: "running",
    });

    expect(() =>
      executeOutput(
        {
          action: "output",
          id: "proc_1",
          pattern: "([",
          mode: "regex",
        } as never,
        manager,
      ),
    ).toThrow("not a valid regular expression");
  });

  it("tails to requested tailLines", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const manager = mockManager({
      stdout: lines,
      stderr: [],
      status: "running",
    });

    const result = executeOutput(
      { action: "output", id: "proc_1", tailLines: 10 } as never,
      manager,
    );

    expect(result.stdout).toHaveLength(10);
    expect(result.stdout[0]).toBe("line 190");
    expect(result.stdout[9]).toBe("line 199");
  });

  it("uses larger scan window when pattern is present", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const manager = mockManager({
      stdout: lines,
      stderr: [],
      status: "running",
    });

    // Pattern present: getOutput should be called with MAX_OUTPUT_SCAN_LINES (5000)
    executeOutput(
      { action: "output", id: "proc_1", pattern: "line 99" } as never,
      manager,
    );

    expect(manager.getOutput).toHaveBeenCalledWith("proc_1", 5000);
  });

  it("uses tailLines as scan window when no pattern", () => {
    const manager = mockManager({
      stdout: ["line"],
      stderr: [],
      status: "running",
    });

    executeOutput(
      { action: "output", id: "proc_1", tailLines: 50 } as never,
      manager,
    );

    expect(manager.getOutput).toHaveBeenCalledWith("proc_1", 50);
  });

  it("clamps tailLines to valid range", () => {
    const manager = mockManager({
      stdout: ["line"],
      stderr: [],
      status: "running",
    });

    const result = executeOutput(
      { action: "output", id: "proc_1", tailLines: 9999 } as never,
      manager,
    );

    expect(result.tailLines).toBe(2000);
  });

  it("defaults tailLines to 100", () => {
    const manager = mockManager({
      stdout: ["line"],
      stderr: [],
      status: "running",
    });

    const result = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(result.tailLines).toBe(100);
  });

  it("includes log file paths in details", () => {
    const manager = mockManager({
      stdout: [],
      stderr: [],
      status: "running",
    });

    const result = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(result.stdoutFile).toBe("/tmp/proc_1.stdout.log");
    expect(result.stderrFile).toBe("/tmp/proc_1.stderr.log");
  });
});

describe("formatOutputDetails", () => {
  function makeDetails(overrides: Partial<OutputDetails> = {}): OutputDetails {
    return {
      action: "output",
      id: "proc_1",
      processName: "server",
      processStatus: "running",
      stream: "both",
      tailLines: 100,
      pattern: null,
      mode: "literal",
      stdout: ["hello world"],
      stderr: [],
      stdoutFile: "/tmp/proc_1.stdout.log",
      stderrFile: "/tmp/proc_1.stderr.log",
      ...overrides,
    };
  }

  it("formats basic output with header and stdout", () => {
    const text = formatOutputDetails(makeDetails());
    expect(text).toContain('"server" (proc_1) [running]');
    expect(text).toContain("stdout:");
    expect(text).toContain("hello world");
    expect(text).toContain(
      "Process is still running. Use watches instead of polling.",
    );
  });

  it("includes filter info when pattern is set", () => {
    const text = formatOutputDetails(
      makeDetails({ pattern: "error", mode: "regex" }),
    );
    expect(text).toContain("filter: error (regex)");
  });

  it("shows stderr section when stderr has content", () => {
    const text = formatOutputDetails(
      makeDetails({ stderr: ["something broke"] }),
    );
    expect(text).toContain("stderr:");
    expect(text).toContain("something broke");
  });

  it("shows 'No output yet' when both streams empty and no pattern", () => {
    const text = formatOutputDetails(makeDetails({ stdout: [], stderr: [] }));
    expect(text).toContain("No output yet.");
  });

  it("shows 'No matching lines found' when both streams empty and pattern set", () => {
    const text = formatOutputDetails(
      makeDetails({ stdout: [], stderr: [], pattern: "missing" }),
    );
    expect(text).toContain("No matching lines found.");
  });

  it("does not add polling guidance for finished processes", () => {
    const text = formatOutputDetails(makeDetails({ processStatus: "exited" }));
    expect(text).not.toContain("Use watches instead of polling");
  });
});
