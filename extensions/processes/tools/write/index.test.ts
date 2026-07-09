import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo, WriteResult } from "../../../../src/types";
import { executeWrite, formatWriteDetails } from ".";

const processInfo: ProcessInfo = {
  id: "proc_1",
  name: "repl",
  pid: 123,
  command: "node",
  cwd: "/repo",
  startTime: 1000,
  endTime: null,
  status: "running",
  exitCode: null,
  success: null,
  stdoutFile: "/tmp/stdout.log",
  stderrFile: "/tmp/stderr.log",
  endReason: null,
  signal: null,
  errorMessage: null,
};

function makeManager(overrides: Partial<ProcessManager> = {}): ProcessManager {
  return {
    get: vi.fn(() => processInfo),
    writeToStdin: vi.fn(() => ({ ok: true as const })),
    ...overrides,
  } as unknown as ProcessManager;
}

describe("executeWrite", () => {
  it("writes text to stdin and reports byte count", () => {
    const writeToStdin = vi.fn(() => ({ ok: true as const }));
    const manager = makeManager({ writeToStdin });

    const details = executeWrite(
      { action: "write", id: "proc_1", input: "hello\n" },
      manager,
    );

    expect(writeToStdin).toHaveBeenCalledWith("proc_1", "hello\n", {
      end: false,
    });
    expect(details.ok).toBe(true);
    expect(details.bytes).toBe(Buffer.byteLength("hello\n", "utf-8"));
    expect(details.end).toBe(false);
    expect(details.processName).toBe("repl");
  });

  it("defaults input to an empty string so end-only writes close stdin", () => {
    const writeToStdin = vi.fn(() => ({ ok: true as const }));
    const manager = makeManager({ writeToStdin });

    const details = executeWrite(
      { action: "write", id: "proc_1", end: true },
      manager,
    );

    expect(writeToStdin).toHaveBeenCalledWith("proc_1", "", { end: true });
    expect(details.ok).toBe(true);
    expect(details.bytes).toBe(0);
    expect(details.end).toBe(true);
  });

  it("surfaces the manager's reason on failure", () => {
    const writeToStdin = vi.fn(
      (): WriteResult => ({ ok: false, reason: "stdin_closed" }),
    );
    const manager = makeManager({ writeToStdin });

    const details = executeWrite(
      { action: "write", id: "proc_1", input: "x" },
      manager,
    );

    expect(details.ok).toBe(false);
    expect(details.reason).toBe("stdin_closed");
    expect(details.bytes).toBe(0);
  });

  it("throws when id is missing", () => {
    const manager = makeManager();
    expect(() =>
      executeWrite({ action: "write", input: "x" }, manager),
    ).toThrow(/requires id/);
  });

  it("throws when called with no input and end not set (no-op guard)", () => {
    const writeToStdin = vi.fn(() => ({ ok: true as const }));
    const manager = makeManager({ writeToStdin });

    expect(() =>
      executeWrite({ action: "write", id: "proc_1" }, manager),
    ).toThrow(/requires "input" or "end"/);
    expect(writeToStdin).not.toHaveBeenCalled();
  });

  it("still closes stdin when end is set without input", () => {
    const writeToStdin = vi.fn(() => ({ ok: true as const }));
    const manager = makeManager({ writeToStdin });

    const details = executeWrite(
      { action: "write", id: "proc_1", end: true },
      manager,
    );

    expect(writeToStdin).toHaveBeenCalledWith("proc_1", "", { end: true });
    expect(details.ok).toBe(true);
  });
});

describe("formatWriteDetails", () => {
  it("reports bytes written on success", () => {
    const text = formatWriteDetails({
      action: "write",
      id: "proc_1",
      processName: "repl",
      process: processInfo,
      bytes: 6,
      end: false,
      ok: true,
      reason: null,
    });
    expect(text).toContain('Wrote 6 bytes to "repl" (proc_1)');
    expect(text).not.toContain("closed stdin");
  });

  it("notes stdin closure when end is set", () => {
    const text = formatWriteDetails({
      action: "write",
      id: "proc_1",
      processName: "repl",
      process: processInfo,
      bytes: 1,
      end: true,
      ok: true,
      reason: null,
    });
    expect(text).toContain("and closed stdin");
  });

  it("reports the reason on failure", () => {
    const text = formatWriteDetails({
      action: "write",
      id: "proc_1",
      processName: "repl",
      process: processInfo,
      bytes: 0,
      end: false,
      ok: false,
      reason: "stdin_closed",
    });
    expect(text).toContain("Failed to write");
    expect(text).toContain("stdin_closed");
  });
});
