import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { RequestListPayload } from "../../src/protocol";
import { CHANNELS } from "../../src/protocol";
import type { ProcessInfo } from "../../src/types";
import { allProcessCompletions } from "./completions";

function makeInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "dev",
    pid: 123,
    command: "pnpm dev",
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
    ...overrides,
  };
}

function mockList(
  events: ReturnType<typeof createEventBus>,
  processes: ProcessInfo[],
): void {
  events.on(CHANNELS.REQUEST_LIST, (payload: unknown) => {
    const p = payload as RequestListPayload;
    p.reply(processes);
  });
}

describe("allProcessCompletions", () => {
  it("returns all processes when prefix is empty", () => {
    const events = createEventBus();
    mockList(events, [
      makeInfo({ id: "proc_1", name: "frontend" }),
      makeInfo({ id: "proc_2", name: "backend" }),
    ]);

    const completions = allProcessCompletions(events)("");
    expect(completions).toHaveLength(2);
    expect(completions?.map((c) => c.value)).toEqual(["proc_1", "proc_2"]);
  });

  it("filters by id prefix", () => {
    const events = createEventBus();
    mockList(events, [
      makeInfo({ id: "abc_1", name: "frontend" }),
      makeInfo({ id: "xyz_2", name: "backend" }),
    ]);

    const completions = allProcessCompletions(events)("ab");
    expect(completions).toHaveLength(1);
    expect(completions?.[0]?.value).toBe("abc_1");
  });

  it("filters by name substring", () => {
    const events = createEventBus();
    mockList(events, [
      makeInfo({ id: "proc_1", name: "frontend" }),
      makeInfo({ id: "proc_2", name: "backend" }),
    ]);

    const completions = allProcessCompletions(events)("back");
    expect(completions).toHaveLength(1);
    expect(completions?.[0]?.value).toBe("proc_2");
  });

  it("returns null when nothing matches", () => {
    const events = createEventBus();
    mockList(events, [makeInfo()]);

    expect(allProcessCompletions(events)("zzz")).toBeNull();
  });

  it("is case-insensitive", () => {
    const events = createEventBus();
    mockList(events, [makeInfo({ id: "PROC_1", name: "FRONTEND" })]);

    const completions = allProcessCompletions(events)("proc");
    expect(completions).toHaveLength(1);

    const byName = allProcessCompletions(events)("front");
    expect(byName).toHaveLength(1);
  });
});
