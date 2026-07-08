import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ProcessInfo } from "../../../src/types";
import {
  applyOverviewView,
  formatStatusShort,
  type OverviewFilter,
  type OverviewSort,
  renderStatusDot,
} from "./overview-component";

function makeTheme(): Theme {
  return {
    fg: (color: string, text: string) => `{${color}:${text}}`,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}

function makeProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "dev",
    pid: 1,
    command: "pnpm dev",
    cwd: "/tmp",
    startTime: 1000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "",
    stderrFile: "",
    endReason: null,
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("applyOverviewView", () => {
  const running = makeProcess({
    id: "proc_1",
    name: "dev",
    status: "running",
    startTime: 100,
  });
  const exitedOk = makeProcess({
    id: "proc_2",
    name: "build",
    status: "exited",
    success: true,
    startTime: 200,
  });
  const failed = makeProcess({
    id: "proc_3",
    name: "audit",
    status: "exited",
    success: false,
    startTime: 300,
  });
  const killed = makeProcess({
    id: "proc_4",
    name: "watcher",
    status: "killed",
    success: false,
    startTime: 50,
  });

  it("sorts live-first then newest start by default (status)", () => {
    const result = applyOverviewView(
      [exitedOk, killed, running, failed],
      "status",
      "all",
      "",
    );
    expect(result.map((p) => p.id)).toEqual([
      "proc_1",
      "proc_3",
      "proc_2",
      "proc_4",
    ]);
  });

  it("sorts by started (newest first)", () => {
    const result = applyOverviewView(
      [running, exitedOk, failed],
      "started",
      "all",
      "",
    );
    expect(result.map((p) => p.id)).toEqual(["proc_3", "proc_2", "proc_1"]);
  });

  it("sorts by name (alphabetical)", () => {
    const result = applyOverviewView(
      [running, exitedOk, failed],
      "name",
      "all",
      "",
    );
    expect(result.map((p) => p.name)).toEqual(["audit", "build", "dev"]);
  });

  it("filters to running only", () => {
    const result = applyOverviewView(
      [running, exitedOk, failed, killed],
      "status",
      "running",
      "",
    );
    expect(result.map((p) => p.id)).toEqual(["proc_1"]);
  });

  it("filters to finished only", () => {
    const result = applyOverviewView(
      [running, exitedOk, failed, killed],
      "status",
      "finished",
      "",
    );
    expect(result.map((p) => p.id)).toEqual(["proc_3", "proc_2", "proc_4"]);
  });

  it("applies a case-insensitive quick filter on name", () => {
    const result = applyOverviewView(
      [running, exitedOk, failed],
      "status",
      "all",
      "BUI",
    );
    expect(result.map((p) => p.name)).toEqual(["build"]);
  });

  it("returns an empty array when nothing matches the quick filter", () => {
    const result = applyOverviewView(
      [running, exitedOk],
      "status",
      "all",
      "nope",
    );
    expect(result).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [running, exitedOk];
    applyOverviewView(input, "started", "all", "");
    expect(input.map((p) => p.id)).toEqual(["proc_1", "proc_2"]);
  });

  it("sort:status keeps a stable preference for live processes", () => {
    const sort: OverviewSort = "status";
    const filter: OverviewFilter = "all";
    const result = applyOverviewView([exitedOk, running], sort, filter, "");
    expect(result[0]?.id).toBe("proc_1");
  });
});

describe("formatStatusShort", () => {
  it("returns running statuses verbatim", () => {
    expect(formatStatusShort(makeProcess({ status: "running" }))).toBe(
      "running",
    );
    expect(formatStatusShort(makeProcess({ status: "terminating" }))).toBe(
      "terminating",
    );
  });

  it("renders exited+success as 'exited'", () => {
    expect(
      formatStatusShort(makeProcess({ status: "exited", success: true })),
    ).toBe("exited");
  });

  it("renders exited+failure as 'failed'", () => {
    expect(
      formatStatusShort(makeProcess({ status: "exited", success: false })),
    ).toBe("failed");
  });

  it("renders killed as 'killed' even though success is false", () => {
    expect(
      formatStatusShort(makeProcess({ status: "killed", success: false })),
    ).toBe("killed");
  });
});

describe("renderStatusDot", () => {
  const theme = makeTheme();

  it("uses error '!' for failed non-killed processes", () => {
    const dot = renderStatusDot(
      makeProcess({ status: "exited", success: false }),
      false,
      theme,
    );
    expect(dot).toBe("{error:!}");
  });

  it("uses accent dot for a selected running process", () => {
    const dot = renderStatusDot(
      makeProcess({ status: "running" }),
      true,
      theme,
    );
    expect(dot).toBe("{accent:●}");
  });

  it("uses dim dot for an unselected running process", () => {
    const dot = renderStatusDot(
      makeProcess({ status: "running" }),
      false,
      theme,
    );
    expect(dot).toBe("{dim:○}");
  });

  it("uses success dot for exited-ok processes", () => {
    const dot = renderStatusDot(
      makeProcess({ status: "exited", success: true }),
      false,
      theme,
    );
    expect(dot).toBe("{success:●}");
  });

  it("uses warning dot for terminating processes", () => {
    const dot = renderStatusDot(
      makeProcess({ status: "terminating" }),
      false,
      theme,
    );
    expect(dot).toBe("{warning:●}");
  });

  it("uses dim square for killed processes", () => {
    const dot = renderStatusDot(
      makeProcess({ status: "killed", success: false }),
      false,
      theme,
    );
    expect(dot).toBe("{dim:■}");
  });
});
