import type { Theme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { configLoader } from "../../config";
import type { ExecuteResult, ProcessInfo } from "../../constants";
import type { ProcessManager } from "../../manager";
import { executeOutput, renderOutputResult } from "./output";
import { MAX_OUTPUT_BYTES, truncateTail } from "./output-truncate";

const STDOUT_FILE = "/tmp/proc_1-stdout.log";
const STDERR_FILE = "/tmp/proc_1-stderr.log";

interface OutputSnapshot {
  stdout: string[];
  stderr: string[];
  status: string;
}

function mockProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "server",
    pid: 1234,
    command: "npm start",
    cwd: "/project",
    startTime: 1,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: STDOUT_FILE,
    stderrFile: STDERR_FILE,
    alertOnSuccess: false,
    alertOnFailure: true,
    alertOnKill: false,
    ...overrides,
  };
}

function mockManager(
  output: OutputSnapshot | null,
  processOverrides: Partial<ProcessInfo> = {},
): ProcessManager {
  const process = mockProcess(processOverrides);
  return {
    get: vi.fn().mockReturnValue(process),
    getOutput: vi.fn().mockReturnValue(output),
    getLogFiles: vi.fn().mockReturnValue({
      stdoutFile: STDOUT_FILE,
      stderrFile: STDERR_FILE,
      combinedFile: "/tmp/proc_1-combined.log",
    }),
  } as unknown as ProcessManager;
}

function runOutput(output: OutputSnapshot): ExecuteResult {
  return executeOutput({ id: "proc_1" }, mockManager(output));
}

beforeAll(async () => {
  await configLoader.load();
});

function contentText(result: ExecuteResult): string {
  const block = result.content[0];
  return block && block.type === "text" ? block.text : "";
}

describe("executeOutput", () => {
  it("formats normal stdout and stderr", () => {
    const result = runOutput({
      stdout: ["line 1", "line 2"],
      stderr: ["err 1"],
      status: "running",
    });

    const content = contentText(result);
    expect(content).toContain("stdout:");
    expect(content).toContain("line 1");
    expect(content).toContain("line 2");
    expect(content).toContain("stderr:");
    expect(content).toContain("err 1");
    expect(content).toContain("2 stdout lines, 1 stderr lines");
  });

  it("strips ANSI and terminal control characters before persistence", () => {
    const result = runOutput({
      stdout: ["\u001b[31mred\u001b[0m", "step 1\rstep 2\b done"],
      stderr: [],
      status: "exited",
    });

    const content = contentText(result);
    expect(content).not.toContain("\u001b[31m");
    expect(content).not.toContain("\r");
    expect(content).not.toContain("\b");
    expect(content).toContain("red");
    expect(content).toContain("step 1step 2 done");
  });

  it("never persists stdout, stderr, or output arrays in new result details", () => {
    const result = runOutput({
      stdout: ["line 1"],
      stderr: ["err 1"],
      status: "running",
    });

    const { details } = result;
    expect(details.output).toBeUndefined();
  });

  it("does not embed raw process output in serialized details", () => {
    const result = runOutput({
      stdout: ["SECRET-stdout-token"],
      stderr: ["SECRET-stderr-token"],
      status: "running",
    });

    const serialized = JSON.stringify(result.details);
    expect(serialized).not.toContain("SECRET-stdout-token");
    expect(serialized).not.toContain("SECRET-stderr-token");
    // The raw-output property is absent from new result details.
    expect(result.details.output).toBeUndefined();
    expect("output" in JSON.parse(serialized)).toBe(false);
  });

  it("bounds a 2 MiB single line without growing the session entry", () => {
    const huge = "x".repeat(2 * 1024 * 1024);
    const result = runOutput({ stdout: [huge], stderr: [], status: "running" });

    const serialized = JSON.stringify(result);
    // Serialized result (content + details) stays below a fixed safe ceiling.
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThan(128 * 1024);
    // The newest output still surfaces a partial suffix.
    expect(contentText(result)).toContain("x");
    expect(result.details.truncation?.truncated).toBe(true);
    expect(result.details.truncation?.lastLinePartial).toBe(true);
  });

  it("handles CR-only progress output without session growth", () => {
    // CR-only progress collapses into a single line carrying the final state.
    const progress = `${Array.from({ length: 1000 }, (_, i) => `phase ${i}\r`).join("")}done`;
    const result = runOutput({
      stdout: [progress],
      stderr: [],
      status: "running",
    });

    const serialized = JSON.stringify(result);
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThan(128 * 1024);
    expect(contentText(result)).not.toContain("\r");
    expect(contentText(result)).toContain("done");
  });

  it("accounts for JSON-escaping expansion for a tab-heavy line", () => {
    // Tabs survive stripAnsi but expand under JSON.stringify.
    const tabHeavy = `${"\t".repeat(200_000)}tail-marker`;
    const result = runOutput({
      stdout: [tabHeavy],
      stderr: [],
      status: "running",
    });

    const serialized = JSON.stringify(result);
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThan(128 * 1024);
    expect(contentText(result)).toContain("tail-marker");
  });

  it("keeps a UTF-8-safe suffix when an oversized multibyte line is truncated", () => {
    // Use a 4-byte UTF-8 codepoint (U+1F680) so an arbitrary mid-byte cut
    // would produce replacement characters. Keep enough multibyte content so
    // the suffix definitely lands inside a code point run.
    const emoji = "\u{1F680}".repeat(50_000); // ~200 KiB
    const result = runOutput({
      stdout: [emoji],
      stderr: [],
      status: "running",
    });

    expect(result.details.truncation?.lastLinePartial).toBe(true);
  });

  it("bounds combined large stdout and stderr", () => {
    const stdout = Array.from({ length: 5000 }, (_, i) => `out ${i}`);
    const stderr = Array.from({ length: 5000 }, (_, i) => `err ${i}`);
    const result = runOutput({ stdout, stderr, status: "running" });

    const serialized = JSON.stringify(result);
    expect(Buffer.byteLength(serialized, "utf-8")).toBeLessThan(128 * 1024);
    // Newest stderr lines are kept (they form the tail of the combined body).
    expect(contentText(result)).toContain("err 4999");
  });

  it("keeps the final serialized tool result below a fixed safe ceiling", () => {
    const stdout = Array.from({ length: 10_000 }, (_, i) => `line ${i}`);
    const stderr = Array.from({ length: 10_000 }, (_, i) => `err  ${i}`);
    const result = runOutput({ stdout, stderr, status: "running" });

    expect(Buffer.byteLength(JSON.stringify(result), "utf-8")).toBeLessThan(
      128 * 1024,
    );
  });

  it("always retains complete log file paths in the textual result", () => {
    const stdout = Array.from({ length: 10_000 }, (_, i) => `line ${i}`);
    const result = runOutput({ stdout, stderr: [], status: "running" });

    const content = contentText(result);
    expect(content).toContain(STDOUT_FILE);
    expect(content).toContain(STDERR_FILE);
  });

  it("returns failure details without log files when the process is missing", () => {
    const manager = {
      get: vi.fn().mockReturnValue(null),
      getOutput: vi.fn(),
      getLogFiles: vi.fn(),
    } as unknown as ProcessManager;

    const result = executeOutput({ id: "missing" }, manager);
    expect(result.details.success).toBe(false);
    expect(result.details.logFiles).toBeUndefined();
    expect(result.details.output).toBeUndefined();
  });

  it("includes truncation metadata in details when content is truncated", () => {
    const result = runOutput({
      stdout: Array.from({ length: 5000 }, (_, i) => `line ${i}`),
      stderr: [],
      status: "running",
    });

    expect(result.details.truncation).toBeDefined();
    expect(result.details.truncation?.truncated).toBe(true);
    expect(result.details.truncation?.totalLines).toBeGreaterThan(
      result.details.truncation?.outputLines ?? 0,
    );
    // Raw output never leaks through truncation metadata.
    expect(JSON.stringify(result.details.truncation)).not.toContain(
      "line 4999",
    );
  });
});

describe("truncateTail (hardening)", () => {
  it("keeps the newest lines within the byte and line budgets", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const result = truncateTail(text, {
      maxBytes: MAX_OUTPUT_BYTES,
      maxLines: 10,
    });

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("line 99");
    expect(result.content).not.toContain("line 0");
    expect(result.outputLines).toBeLessThanOrEqual(10);
  });

  it("returns a UTF-8-safe suffix from a single oversized line", () => {
    const huge = "\u{1F680}".repeat(50_000);
    const result = truncateTail(huge, { maxBytes: 1024, maxLines: 10 });

    expect(result.truncated).toBe(true);
    expect(result.lastLinePartial).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    // No partial UTF-8 sequences reach the output.
    expect(Buffer.from(result.content, "utf-8").toString("utf-8")).toBe(
      result.content,
    );
    expect(result.content).not.toContain("\uFFFD");
  });
});

// --- Renderer coverage ---

function mockTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "truecolor",
    getThinkingBorderColor: () => (text: string) => text,
    getBashModeBorderColor: () => (text: string) => text,
  } as unknown as Theme;
}

function render(
  result: ExecuteResult,
  options: { expanded?: boolean } = {},
): string[] {
  const body = renderOutputResult(
    result as never,
    { expanded: options.expanded ?? false } as never,
    mockTheme(),
  );
  return body.render(120);
}

describe("renderOutputResult", () => {
  it("renders expanded content-based output from tool-result content", () => {
    const result = runOutput({
      stdout: ["ready on http://localhost:3000"],
      stderr: [],
      status: "running",
    });

    const lines = render(result, { expanded: true });
    const joined = lines.join("\n");

    expect(joined).toContain("ready on http://localhost:3000");
    expect(joined).toContain("Log files:");
    expect(joined).toContain(STDOUT_FILE);
    expect(joined).toContain(STDERR_FILE);
  });

  it("renders a collapsed preview from the bounded content", () => {
    const result = runOutput({
      stdout: ["first", "second", "third"],
      stderr: [],
      status: "running",
    });

    const lines = render(result, { expanded: false });
    const joined = lines.join("\n");

    expect(joined).toContain("third");
    expect(joined).toContain("Output");
  });

  it("surfaces the truncation notice and log paths in expanded view", () => {
    const result = runOutput({
      stdout: Array.from({ length: 5000 }, (_, i) => `line ${i}`),
      stderr: [],
      status: "running",
    });

    const lines = render(result, { expanded: true });
    const joined = lines.join("\n");

    expect(result.details.truncation?.truncated).toBe(true);
    expect(joined).toContain("Preview truncated");
    expect(joined).toContain(STDOUT_FILE);
    expect(joined).toContain(STDERR_FILE);
  });

  it("renders legacy session results that still carry details.output", () => {
    const legacy = {
      content: [{ type: "text" as const, text: "legacy content" }],
      details: {
        action: "output" as const,
        success: true,
        message: '"server" (proc_1) [running]: 1 stdout lines, 0 stderr lines',
        output: {
          stdout: ["legacy stdout line"],
          stderr: [],
          status: "running",
        },
        logFiles: {
          stdoutFile: STDOUT_FILE,
          stderrFile: STDERR_FILE,
        },
      },
    };

    const lines = render(legacy, { expanded: true });
    const joined = lines.join("\n");

    expect(joined).toContain("legacy stdout line");
    expect(joined).toContain("Log files:");
    expect(joined).toContain(STDOUT_FILE);
  });

  it("does not mutate result details during rendering", () => {
    const result = runOutput({
      stdout: ["line 1"],
      stderr: ["err 1"],
      status: "running",
    });

    const before = JSON.stringify(result.details);
    render(result, { expanded: true });
    render(result, { expanded: false });
    const after = JSON.stringify(result.details);

    expect(after).toBe(before);
  });
});
