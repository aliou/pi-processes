import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { OutputDetails } from "./index";
import {
  buildCollapsed,
  buildExpanded,
  buildFooter,
  buildHeader,
} from "./render";

function createMockTheme(): Theme {
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
    stdoutFile: "/tmp/proc_1.stdout.log",
    stderrFile: "/tmp/proc_1.stderr.log",
    ...overrides,
  };
}

function makeContent(
  overrides: {
    processName?: string;
    id?: string;
    processStatus?: string;
    pattern?: string | null;
    mode?: string;
    stdout?: string[];
    stderr?: string[];
    truncated?: boolean;
    stdoutFile?: string;
    stderrFile?: string;
  } = {},
): string {
  const {
    processName = "server",
    id = "proc_1",
    processStatus = "running",
    pattern = null,
    mode = "literal",
    stdout = [],
    stderr = [],
    truncated = false,
    stdoutFile = "/tmp/proc_1.stdout.log",
    stderrFile = "/tmp/proc_1.stderr.log",
  } = overrides;

  const parts: string[] = [];
  parts.push(`"${processName}" (${id}) [${processStatus}]`);

  if (pattern) {
    const modeTag = mode === "regex" ? " (regex)" : "";
    parts.push(`filter: ${pattern}${modeTag}`);
  }

  if (stdout.length > 0) {
    parts.push("", "stdout:");
    parts.push(...stdout);
  }

  if (stderr.length > 0) {
    parts.push("", "stderr:");
    parts.push(...stderr);
  }

  if (stdout.length === 0 && stderr.length === 0) {
    parts.push("", "No output yet.");
  }

  if (processStatus === "running") {
    parts.push("", "Process is still running. Use watches instead of polling.");
  }

  if (truncated) {
    parts.push(
      "",
      "[Preview truncated by 50.0KB byte limit; showing 1 lines / 10B of 1 lines / 100B.]",
    );
  }

  parts.push(
    "",
    "[Complete currently-retained logs:",
    `stdout=${stdoutFile}`,
    `stderr=${stderrFile}]`,
  );

  return parts.join("\n");
}

describe("output render", () => {
  const theme = createMockTheme();

  it("buildHeader renders the output action header", () => {
    const container = buildHeader(
      { action: "output", id: "proc_1" } as never,
      theme,
    );
    const lines = container.render(80);
    expect(lines.some((line) => line.includes("output"))).toBe(true);
  });

  it("buildExpanded renders bounded content from the tool-result text", () => {
    const content = makeContent({
      stdout: ["hello", "world"],
      stderr: ["error"],
    });

    const container = buildExpanded(content, makeDetails(), theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("stdout:"))).toBe(true);
    expect(lines.some((line) => line.includes("hello"))).toBe(true);
    expect(lines.some((line) => line.includes("world"))).toBe(true);
    expect(lines.some((line) => line.includes("stderr:"))).toBe(true);
    expect(lines.some((line) => line.includes("error"))).toBe(true);
  });

  it("buildExpanded renders metadata from details", () => {
    const content = makeContent({ stdout: ["hello"] });
    const details = makeDetails({ pattern: "hello", mode: "literal" });

    const container = buildExpanded(content, details, theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("name: server"))).toBe(true);
    expect(lines.some((line) => line.includes("id: proc_1"))).toBe(true);
    expect(lines.some((line) => line.includes("status: running"))).toBe(true);
    expect(lines.some((line) => line.includes("stream: both"))).toBe(true);
    expect(lines.some((line) => line.includes("filter: hello"))).toBe(true);
  });

  it("buildExpanded shows empty message when content has no output", () => {
    const content = makeContent();
    const container = buildExpanded(content, makeDetails(), theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("No output yet"))).toBe(true);
  });

  it("buildExpanded renders truncation notice and ignores log-path footer duplication", () => {
    const content = makeContent({
      stdout: ["x".repeat(1000)],
      truncated: true,
    });
    const details = makeDetails({
      truncation: {
        truncated: true,
        truncatedBy: "bytes",
        totalLines: 1,
        totalBytes: 1000,
        outputLines: 1,
        outputBytes: 10,
        lastLinePartial: true,
        firstLineExceedsLimit: false,
        maxLines: 2000,
        maxBytes: 51200,
      },
    });

    const container = buildExpanded(content, details, theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("Preview truncated"))).toBe(true);
    expect(
      lines.some((line) => line.includes("Complete currently-retained logs")),
    ).toBe(false);
  });

  it("buildCollapsed renders status and a short content-derived preview", () => {
    const content = makeContent({
      stdout: ["first", "second", "third"],
    });

    const container = buildCollapsed(content, makeDetails(), theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("server"))).toBe(true);
    expect(lines.some((line) => line.includes("proc_1"))).toBe(true);
    expect(lines.some((line) => line.includes("running"))).toBe(true);
    expect(lines.some((line) => line.includes("second"))).toBe(true);
    expect(lines.some((line) => line.includes("third"))).toBe(true);
    expect(lines.some((line) => line.includes("first"))).toBe(false);
  });

  it("buildCollapsed ignores running guidance when selecting the preview", () => {
    const content = makeContent({ stdout: ["latest output"] });

    const container = buildCollapsed(content, makeDetails(), theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("latest output"))).toBe(true);
    expect(lines.some((line) => line.includes("Use watches"))).toBe(false);
  });

  it("buildCollapsed shows empty message when there is no output", () => {
    const content = makeContent();
    const container = buildCollapsed(content, makeDetails(), theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("No output yet"))).toBe(true);
  });

  it("buildFooter renders log paths from details", () => {
    const details = makeDetails();
    const container = buildFooter(details, { expanded: true }, theme);
    const lines = container?.render(80) ?? [];

    expect(lines.some((line) => line.includes("logs:"))).toBe(true);
    expect(lines.some((line) => line.includes(details.stdoutFile))).toBe(true);
    expect(lines.some((line) => line.includes(details.stderrFile))).toBe(true);
  });

  it("buildFooter returns null when collapsed", () => {
    const container = buildFooter(makeDetails(), { expanded: false }, theme);
    expect(container).toBeNull();
  });

  it("renders legacy details with oversized arrays from content", () => {
    const content = makeContent({
      stdout: ["visible line"],
      stderr: [],
    });

    // Legacy details may still carry raw stdout/stderr arrays, but the renderer
    // must ignore them and use the bounded content text instead.
    const legacyDetails = {
      ...makeDetails(),
      stdout: ["x".repeat(2 * 1024 * 1024)],
      stderr: ["y".repeat(2 * 1024 * 1024)],
    } as OutputDetails;

    const container = buildExpanded(content, legacyDetails, theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("visible line"))).toBe(true);
    expect(
      lines.some((line) => line.includes("x".repeat(2 * 1024 * 1024))),
    ).toBe(false);
  });

  it("does not treat a footer-like output line as the final footer", () => {
    const content = makeContent({
      stdout: ["[Complete currently-retained logs:", "still visible"],
    });

    const container = buildExpanded(content, makeDetails(), theme);
    const lines = container.render(80);

    expect(
      lines.some((line) => line.includes("Complete currently-retained logs")),
    ).toBe(true);
    expect(lines.some((line) => line.includes("still visible"))).toBe(true);
  });

  it("does not treat an output line as a truncation notice", () => {
    const content = makeContent({
      stdout: ["[Preview truncated by the process", "still visible"],
    });

    const container = buildExpanded(content, makeDetails(), theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("the process"))).toBe(true);
    expect(lines.some((line) => line.includes("still visible"))).toBe(true);
  });

  it("keeps the first output line when legacy tail truncation removed the header", () => {
    const content = [
      "retained suffix",
      "",
      "[Showing lines 50-100 of 100. Full logs: /tmp/out , /tmp/err]",
    ].join("\n");

    const container = buildExpanded(content, makeDetails(), theme);
    const lines = container.render(80);

    expect(lines.some((line) => line.includes("retained suffix"))).toBe(true);
  });

  it("does not mutate result details during rendering", () => {
    const content = makeContent({ stdout: ["hello"] });
    const details = makeDetails();
    const before = JSON.stringify(details);

    buildExpanded(content, details, theme);
    buildCollapsed(content, details, theme);
    buildFooter(details, { expanded: true }, theme);

    expect(JSON.stringify(details)).toBe(before);
  });
});
