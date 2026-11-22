import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import type { ManagerEvent, ProcessInfo } from "../../../src/types";
import { CHANNELS } from "../../shared/protocol";
import { createSessionHolds } from "./session-holds";

function makeInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "build",
    pid: 123,
    command: "pnpm build",
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

function setup() {
  const listeners: Array<(event: ManagerEvent) => void> = [];
  const processes = new Map<string, ProcessInfo>();
  const manager = {
    onEvent(listener: (event: ManagerEvent) => void): () => void {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
    get: (id: string) => processes.get(id) ?? null,
  } as unknown as ProcessManager;
  const events = createEventBus();
  const log: Array<[string, unknown]> = [];
  events.on(CHANNELS.HOLD_STARTED, (p) => log.push(["started", p]));
  events.on(CHANNELS.HOLD_ENDED, (p) => log.push(["ended", p]));
  const holds = createSessionHolds(events, manager);

  const emit = (event: ManagerEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  const start = (overrides: Partial<ProcessInfo> = {}) => {
    const info = makeInfo(overrides);
    processes.set(info.id, info);
    return info;
  };
  const end = (info: ProcessInfo, overrides: Partial<ProcessInfo>) => {
    const ended = { ...info, endTime: 2000, ...overrides };
    processes.set(info.id, ended);
    emit({ type: "process_ended", info: ended });
  };

  return { holds, log, emit, start, end, processes, listeners };
}

const STARTED = [
  "started",
  { id: "proc_1", name: "build", command: "pnpm build" },
];

describe("createSessionHolds", () => {
  it.each([
    ["success", { status: "exited", success: true, exitCode: 0 }, true],
    ["failure", { status: "exited", success: false, exitCode: 1 }, false],
    ["kill", { status: "killed", success: false, endReason: "signal" }, false],
  ] as const)("releases a held job once on %s", (_label, ending, success) => {
    const t = setup();
    const info = t.start();
    t.holds.hold(info);
    t.end(info, ending);
    t.end(info, ending);
    t.holds.dispose();

    expect(t.log).toEqual([STARTED, ["ended", { id: "proc_1", success }]]);
  });

  it("releases a held job once on terminate timeout", () => {
    const t = setup();
    const info = t.start();
    t.holds.hold(info);
    t.processes.set(info.id, {
      ...info,
      status: "terminate_timeout",
      success: false,
      endReason: "kill_timeout",
    });
    t.emit({ type: "processes_changed" });
    t.emit({ type: "processes_changed" });
    t.holds.dispose();

    expect(t.log).toEqual([
      STARTED,
      ["ended", { id: "proc_1", success: false }],
    ]);
  });

  it("releases a held job once when it leaves the registry (clear)", () => {
    const t = setup();
    const info = t.start();
    t.holds.hold(info);
    t.processes.delete(info.id);
    t.emit({ type: "processes_changed" });
    t.holds.dispose();

    expect(t.log).toEqual([
      STARTED,
      ["ended", { id: "proc_1", success: false }],
    ]);
  });

  it("releases every hold once on dispose and stops listening", () => {
    const t = setup();
    const info = t.start();
    t.holds.hold(info);
    t.holds.dispose();
    t.holds.dispose();
    t.end(info, { status: "exited", success: true });

    expect(t.log).toEqual([
      STARTED,
      ["ended", { id: "proc_1", success: false }],
    ]);
    expect(t.listeners).toHaveLength(0);
  });

  it("emits nothing for an unheld job", () => {
    const t = setup();
    const info = t.start();
    t.end(info, { status: "exited", success: true });
    t.emit({ type: "processes_changed" });
    t.holds.dispose();

    expect(t.log).toEqual([]);
  });

  it("does not hold a job that already ended or is held", () => {
    const t = setup();
    const info = t.start({ status: "exited", success: true });
    t.holds.hold(info);
    expect(t.log).toEqual([]);

    const live = t.start();
    t.holds.hold(live);
    t.holds.hold(live);
    expect(t.log).toEqual([STARTED]);
  });
});
