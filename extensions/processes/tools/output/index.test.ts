import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import { MAX_OUTPUT_BYTES, MAX_OUTPUT_TAIL_LINES } from "../schema";
import { executeOutput } from "./index";

const STDOUT_FILE = "/tmp/proc_1.stdout.log";
const STDERR_FILE = "/tmp/proc_1.stderr.log";

function mockManager(
  output: {
    stdout: string[];
    stderr: string[];
    status: string;
  } | null,
  processOverrides: Partial<ProcessInfo> = {},
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
    stdoutFile: STDOUT_FILE,
    stderrFile: STDERR_FILE,
    endReason: null,
    signal: null,
    errorMessage: null,
    ...processOverrides,
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

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(details.action).toBe("output");
    expect(details.stream).toBe("both");
    expect(details.pattern).toBeNull();
    expect(details.mode).toBe("literal");
    expect(details.tailLines).toBe(100);
    expect(content).toContain("stdout:");
    expect(content).toContain("line 1");
    expect(content).toContain("line 2");
    expect(content).toContain("stderr:");
    expect(content).toContain("err 1");
  });

  it("filters to stdout only", () => {
    const manager = mockManager({
      stdout: ["out"],
      stderr: ["err"],
      status: "running",
    });

    const { content } = executeOutput(
      { action: "output", id: "proc_1", stream: "stdout" } as never,
      manager,
    );

    const body = contentBeforeFooter(content);
    expect(body).toContain("out");
    expect(body).not.toContain("err");
  });

  it("filters to stderr only", () => {
    const manager = mockManager({
      stdout: ["out"],
      stderr: ["err"],
      status: "running",
    });

    const { content } = executeOutput(
      { action: "output", id: "proc_1", stream: "stderr" } as never,
      manager,
    );

    const body = contentBeforeFooter(content);
    expect(body).toContain("err");
    expect(body).not.toContain("out");
  });

  it("applies literal pattern filter", () => {
    const manager = mockManager({
      stdout: ["error: crash", "info: ok", "error: fail"],
      stderr: [],
      status: "running",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1", pattern: "error" } as never,
      manager,
    );

    expect(content).toContain("error: crash");
    expect(content).toContain("error: fail");
    expect(content).not.toContain("info: ok");
    expect(details.pattern).toBe("error");
    expect(details.mode).toBe("literal");
  });

  it("applies regex pattern filter", () => {
    const manager = mockManager({
      stdout: ["ERR404", "INFO ok", "ERR500"],
      stderr: [],
      status: "running",
    });

    const { content } = executeOutput(
      {
        action: "output",
        id: "proc_1",
        pattern: "ERR\\d+",
        mode: "regex",
      } as never,
      manager,
    );

    expect(content).toContain("ERR404");
    expect(content).toContain("ERR500");
    expect(content).not.toContain("INFO ok");
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

    const { content } = executeOutput(
      { action: "output", id: "proc_1", tailLines: 10 } as never,
      manager,
    );

    expect(content).toContain("line 190");
    expect(content).toContain("line 199");
    expect(content).not.toContain("line 189");
  });

  it("uses larger scan window when pattern is present", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const manager = mockManager({
      stdout: lines,
      stderr: [],
      status: "running",
    });

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

    const { details } = executeOutput(
      { action: "output", id: "proc_1", tailLines: 9999 } as never,
      manager,
    );

    expect(details.tailLines).toBe(2000);
  });

  it("defaults tailLines to 100", () => {
    const manager = mockManager({
      stdout: ["line"],
      stderr: [],
      status: "running",
    });

    const { details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(details.tailLines).toBe(100);
  });

  it("includes log file paths in content", () => {
    const manager = mockManager({
      stdout: [],
      stderr: [],
      status: "running",
    });

    const { content } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(content).toContain(`stdout=${STDOUT_FILE}`);
    expect(content).toContain(`stderr=${STDERR_FILE}`);
  });

  it("includes process metadata in content", () => {
    const manager = mockManager({
      stdout: ["hello"],
      stderr: [],
      status: "running",
    });

    const { content } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(content).toContain('"server" (proc_1) [running]');
    expect(content).toContain("stdout:");
    expect(content).toContain("hello");
    expect(content).toContain(
      "Process is still running. Use watches instead of polling.",
    );
  });

  it("strips ANSI escape codes from content", () => {
    const manager = mockManager({
      stdout: ["\u001b[31mred text\u001b[0m"],
      stderr: [],
      status: "running",
    });

    const { content } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(content).toContain("red text");
    expect(content).not.toContain("\u001b[");
  });

  it("details never contains stdout or stderr arrays", () => {
    const manager = mockManager({
      stdout: ["hello"],
      stderr: ["world"],
      status: "running",
    });

    const { details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(details).not.toHaveProperty("stdout");
    expect(details).not.toHaveProperty("stderr");
  });

  it("serialized tool result stays bounded for a 2 MiB single line", () => {
    const hugeLine = "x".repeat(2 * 1024 * 1024);
    const manager = mockManager({
      stdout: [hugeLine],
      stderr: [],
      status: "running",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    const toolResult = {
      content: [{ type: "text", text: content }],
      details,
    };

    expect(details.truncation?.truncated).toBe(true);
    expect(content).toContain("x".repeat(100));
    expect(content).toContain(
      "Process is still running. Use watches instead of polling.",
    );
    expect(JSON.stringify(details)).not.toContain("x".repeat(100));
    expect(details.truncation).not.toHaveProperty("content");
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(Buffer.byteLength(JSON.stringify(toolResult), "utf8")).toBeLessThan(
      128 * 1024,
    );
  });

  it("handles CR-only progress output without unbounded session growth", () => {
    const progress = `${"\r".repeat(100_000)}done`;
    const manager = mockManager({
      stdout: [progress],
      stderr: [],
      status: "exited",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(content).toContain("done");
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(
      Buffer.byteLength(JSON.stringify({ content, details }), "utf8"),
    ).toBeLessThan(128 * 1024);
  });

  it("bounds JSON escaping expansion from control characters", () => {
    const manager = mockManager({
      stdout: ["\t".repeat(2 * 1024 * 1024)],
      stderr: [],
      status: "exited",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(content).toContain("\t".repeat(100));
    expect(details.truncation).not.toHaveProperty("content");
    expect(
      Buffer.byteLength(JSON.stringify({ content, details }), "utf8"),
    ).toBeLessThan(128 * 1024);
  });

  it("bounds oversized process names in persisted output results", () => {
    const hugeName = `server-${"x".repeat(2 * 1024 * 1024)}`;
    const manager = mockManager(
      { stdout: ["ready"], stderr: [], status: "running" },
      { name: hugeName },
    );

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(details.processName).toMatch(/^server-/);
    expect(details.processName).toMatch(/…$/u);
    expect(content).toContain("ready");
    expect(
      Buffer.byteLength(JSON.stringify({ content, details }), "utf8"),
    ).toBeLessThan(128 * 1024);
  });

  it("handles large stdout and stderr together", () => {
    const stdout = Array.from({ length: 1000 }, (_, i) => `out ${i}`);
    const stderr = Array.from({ length: 1000 }, (_, i) => `err ${i}`);
    const manager = mockManager({
      stdout,
      stderr,
      status: "running",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1", tailLines: 2000 } as never,
      manager,
    );

    expect(details.truncation?.truncated).toBe(true);
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
  });

  it("preserves multibyte UTF-8 suffix when truncating", () => {
    // Construct a line where the byte limit falls inside a multibyte character.
    const prefix = "a".repeat(MAX_OUTPUT_BYTES - 8);
    const suffix = "é".repeat(100); // 2 bytes each
    const manager = mockManager({
      stdout: [`${prefix}${suffix}`],
      stderr: [],
      status: "exited",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(details.truncation?.truncated).toBe(true);
    expect(details.truncation?.lastLinePartial).toBe(true);
    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
  });

  it("applies line-limit truncation", () => {
    const lines = Array.from({ length: MAX_OUTPUT_TAIL_LINES + 100 }, (_, i) =>
      String(i),
    );
    const manager = mockManager({
      stdout: lines,
      stderr: [],
      status: "running",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1", tailLines: 3000 } as never,
      manager,
    );

    expect(details.truncation?.truncated).toBe(true);
    expect(details.truncation?.truncatedBy).toBe("lines");
    expect(details.truncation?.outputLines).toBeLessThanOrEqual(
      MAX_OUTPUT_TAIL_LINES,
    );
    expect(content).toContain("line limit");
  });

  it("applies byte-limit truncation", () => {
    const line = "x".repeat(MAX_OUTPUT_BYTES + 1000);
    const manager = mockManager({
      stdout: [line],
      stderr: [],
      status: "running",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(details.truncation?.truncated).toBe(true);
    expect(details.truncation?.truncatedBy).toBe("bytes");
    expect(content).toContain("byte limit");
  });

  it("truncation metadata is absent when output fits within limits", () => {
    const manager = mockManager({
      stdout: ["hello"],
      stderr: [],
      status: "running",
    });

    const { details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    expect(details.truncation).toBeUndefined();
  });

  it("raw output text is absent from serialized details", () => {
    const manager = mockManager({
      stdout: ["secret output"],
      stderr: [],
      status: "running",
    });

    const { details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    const serialized = JSON.stringify(details);
    expect(serialized).not.toContain("secret output");
  });

  it("footer allow list is bounded for pathological output", () => {
    const manager = mockManager({
      stdout: ["x".repeat(10 * 1024 * 1024)],
      stderr: ["y".repeat(10 * 1024 * 1024)],
      status: "running",
    });

    const { content, details } = executeOutput(
      { action: "output", id: "proc_1" } as never,
      manager,
    );

    const toolResult = {
      content: [{ type: "text", text: content }],
      details,
    };

    expect(Buffer.byteLength(content, "utf8")).toBeLessThanOrEqual(
      MAX_OUTPUT_BYTES,
    );
    expect(Buffer.byteLength(JSON.stringify(toolResult), "utf8")).toBeLessThan(
      128 * 1024,
    );
  });
});

/**
 * Return the content text before the footer block so stream-filtering
 * assertions are not confused by the labeled log-path footer.
 */
function contentBeforeFooter(content: string): string {
  const footerIdx = content.indexOf("\n[");
  return footerIdx === -1 ? content : content.slice(0, footerIdx);
}
