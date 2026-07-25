import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ProcessInfo } from "../../../src/types";
import { type LogDockSnapshot, renderLogDock } from "./log-dock-component";

function makeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => `[u]${text}[/u]`,
    inverse: (text: string) => text,
    strikethrough: (text: string) => text,
  } as unknown as Theme;
}

function process(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "api-server",
    pid: 123,
    command: "npm run dev -- --port 3000",
    cwd: "/tmp",
    startTime: 1_000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: null,
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<LogDockSnapshot> = {}): LogDockSnapshot {
  const pinnedProcess = process();
  return {
    processes: [pinnedProcess],
    pinnedProcess,
    pinnedLines: [],
    processLogStream: [
      {
        processId: pinnedProcess.id,
        line: { type: "stdout", text: "ready" },
      },
    ],
    previews: new Map([[pinnedProcess.id, { type: "stdout", text: "ready" }]]),
    notifyLines: new Set(),
    notifyCounts: new Map(),
    state: {
      visibility: "collapsed",
      followEnabled: true,
      focusedProcessId: pinnedProcess.id,
    },
    ...overrides,
  };
}

describe("renderLogDock", () => {
  it("renders nothing when closed", () => {
    const lines = renderLogDock(
      snapshot({
        state: {
          visibility: "closed",
          followEnabled: true,
          focusedProcessId: "proc_1",
        },
      }),
      makeTheme(),
      80,
      8,
    );

    expect(lines).toEqual([]);
  });

  it("renders collapsed summary and preview", () => {
    const lines = renderLogDock(snapshot(), makeTheme(), 100, 4);

    expect(lines[0]).toContain("─");
    expect(lines.join("\n")).toContain("api-server");
    expect(lines.join("\n")).toContain("ready");
  });

  it("shows notification badges in collapsed mode", () => {
    const lines = renderLogDock(
      snapshot({ notifyCounts: new Map([["proc_1", 2]]) }),
      makeTheme(),
      100,
      4,
    );

    expect(lines.join("\n")).toContain("▸2");
  });

  it("renders all running process logs in arrival order when unpinned", () => {
    const api = process({ id: "proc_1", name: "api" });
    const web = process({ id: "proc_2", name: "web" });
    const lines = renderLogDock(
      snapshot({
        processes: [api, web],
        pinnedProcess: null,
        pinnedLines: [],
        processLogStream: [
          { processId: api.id, line: { type: "stdout", text: "api 1" } },
          { processId: web.id, line: { type: "stdout", text: "web 1" } },
          { processId: api.id, line: { type: "stdout", text: "api 2" } },
        ],
        state: {
          visibility: "expanded",
          followEnabled: true,
          focusedProcessId: null,
        },
      }),
      makeTheme(),
      100,
      9,
    );

    const output = lines.join("\n");
    expect(lines[0]).toContain("Processes");
    expect(output.indexOf("api 1")).toBeLessThan(output.indexOf("web 1"));
    expect(output.indexOf("web 1")).toBeLessThan(output.indexOf("api 2"));
  });

  it("renders pinned expanded panel with log tail", () => {
    const lines = renderLogDock(
      snapshot({
        pinnedLines: [
          { type: "stdout", text: "server ready" },
          { type: "stderr", text: "warn once" },
        ],
        state: {
          visibility: "expanded",
          followEnabled: true,
          focusedProcessId: "proc_1",
        },
      }),
      makeTheme(),
      100,
      9,
    );

    expect(lines[0]).toContain("Processes");
    expect(lines.join("\n")).toContain("api-server");
    expect(lines.join("\n")).toContain("server ready");
    expect(lines.join("\n")).toContain("warn once");
  });

  it("treats expanded height as log rows, not total widget rows", () => {
    const lines = renderLogDock(
      snapshot({
        pinnedLines: [
          { type: "stdout", text: "line one" },
          { type: "stdout", text: "line two" },
          { type: "stdout", text: "line three" },
        ],
        state: {
          visibility: "expanded",
          followEnabled: true,
          focusedProcessId: "proc_1",
        },
      }),
      makeTheme(),
      100,
      2,
    );

    // Chrome is added on top of the configured log rows:
    // top border + process strip + rule + 2 log rows (no bottom border —
    // the dock opens into the editor below).
    expect(lines).toHaveLength(5);
    expect(lines.join("\n")).toContain("line two");
    expect(lines.join("\n")).toContain("line three");
    expect(lines.join("\n")).not.toContain("line one");
  });

  it("shows notification badges and highlights matching lines", () => {
    const lines = renderLogDock(
      snapshot({
        pinnedLines: [{ type: "stdout", text: "build failed" }],
        notifyLines: new Set(["build failed"]),
        notifyCounts: new Map([["proc_1", 2]]),
        state: {
          visibility: "expanded",
          followEnabled: true,
          focusedProcessId: "proc_1",
        },
      }),
      makeTheme(),
      100,
      9,
    );

    const output = lines.join("\n");
    expect(output).toContain("[u]build failed");
  });

  it("coalesces repeated log lines", () => {
    const lines = renderLogDock(
      snapshot({
        pinnedLines: [
          { type: "stdout", text: "tick" },
          { type: "stdout", text: "tick" },
          { type: "stdout", text: "tick" },
          { type: "stdout", text: "tick" },
        ],
        state: {
          visibility: "expanded",
          followEnabled: true,
          focusedProcessId: "proc_1",
        },
      }),
      makeTheme(),
      100,
      10,
    );

    expect(lines.join("\n")).toContain("… repeated 3 times");
  });
});
