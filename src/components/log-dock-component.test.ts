import type { Theme } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { stripAnsi } from "../utils";
import { LogDockComponent } from "./log-dock-component";

const theme = {
  fg: (_color: Parameters<Theme["fg"]>[0], text: string) => text,
  bold: (text: string) => text,
} as Theme;

function processInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "p1",
    name: "bench-watch",
    pid: 123,
    command: "pnpm test",
    cwd: "/tmp",
    startTime: 1_700_000_000_000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    combinedFile: "/tmp/combined.log",
    watchCount: 1,
    activeWatchCount: 1,
    alertOnSuccess: false,
    alertOnFailure: true,
    alertOnKill: false,
    ...overrides,
  };
}

function manager(processes: ProcessInfo[]): ProcessManager {
  return {
    list: () => processes,
    onEvent: () => () => undefined,
    getCombinedOutput: () => [{ source: "stdout", text: "ready" }],
    getLogFiles: (id: string) => {
      const proc = processes.find((process) => process.id === id);
      if (!proc) return undefined;
      return {
        stdoutFile: proc.stdoutFile,
        stderrFile: proc.stderrFile,
        combinedFile: proc.combinedFile,
      };
    },
  } as unknown as ProcessManager;
}

describe("LogDockComponent", () => {
  it("shows monitor indicators in the collapsed persistent dock", () => {
    const component = new LogDockComponent({
      manager: manager([processInfo()]),
      theme,
      tui: { requestRender() {} },
      mode: "collapsed",
      focusedProcessId: null,
      dockHeight: 3,
    });

    const rendered = stripAnsi(component.render(120).join("\n"));

    expect(rendered).toContain("bench-watch watch:1 alert:fail");
    expect(rendered).toContain("ready");
  });

  it("keeps monitor indicators in the open dock title", () => {
    const component = new LogDockComponent({
      manager: manager([processInfo()]),
      theme,
      tui: { requestRender() {} },
      mode: "open",
      focusedProcessId: null,
      dockHeight: 3,
    });

    const rendered = stripAnsi(component.render(120).join("\n"));

    expect(rendered).toContain("bench-watch watch:1 alert:fail");
  });
});
