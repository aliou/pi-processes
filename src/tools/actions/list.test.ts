import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ExecuteResult, ProcessInfo } from "../../constants";
import { renderListResult } from "./list";

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

function failedProcess(): ProcessInfo {
  return {
    id: "proc_1",
    name: "missing-cwd",
    pid: 0,
    command: "true",
    cwd: "/missing",
    startTime: 1,
    endTime: 2,
    status: "exited",
    exitCode: -1,
    success: false,
    error: "spawn ENOENT",
    stdoutFile: "/tmp/stdout",
    stderrFile: "/tmp/stderr",
    alertOnSuccess: false,
    alertOnFailure: true,
    alertOnKill: false,
  };
}

describe("renderListResult", () => {
  it("omits an unavailable PID from failed process output", () => {
    const process = failedProcess();
    const result: ExecuteResult = {
      content: [{ type: "text", text: "1 process(es)" }],
      details: {
        action: "list",
        success: true,
        message: "1 process(es)",
        processes: [process],
      },
    };

    const body = renderListResult(
      result as never,
      { expanded: true } as never,
      mockTheme(),
    );
    const output = body.render(120).join("\n");

    expect(output).toContain("status: exit(-1)");
    expect(output).not.toContain("pid:");
    expect(output).not.toContain("pid: -1");
  });
});
