import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import { createNotificationRegistry } from "../../notifications/registry";
import { executeUpdate } from "../update";
import { executeList, formatListDetails } from ".";

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

function makeManager(processes: ProcessInfo[]): ProcessManager {
  return {
    list: () => processes,
    get: (id: string) => processes.find((process) => process.id === id) ?? null,
  } as unknown as ProcessManager;
}

describe("executeList duration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes running duration against the list reference time", () => {
    const now = 1_000_000;
    vi.setSystemTime(now);

    const manager = makeManager([
      makeInfo({ startTime: now - 5000, endTime: null, status: "running" }),
    ]);

    const details = executeList(
      manager,
      { action: "list" },
      createNotificationRegistry(),
    );

    expect(details.processes[0].duration).toBe("5s");
  });

  it("uses the actual run duration for stopped processes", () => {
    // System time is far from the process window; duration must ignore it.
    vi.setSystemTime(9_000_000);

    const manager = makeManager([
      makeInfo({
        startTime: 1000,
        endTime: 1000 + 90_000,
        status: "exited",
        success: true,
        exitCode: 0,
      }),
    ]);

    const details = executeList(
      manager,
      { action: "list" },
      createNotificationRegistry(),
    );

    expect(details.processes[0].duration).toBe("1m 30s");
  });

  it("uses a single reference time for all running processes", () => {
    const now = 2_000_000;
    vi.setSystemTime(now);

    const manager = makeManager([
      makeInfo({ id: "a", startTime: now - 3000, endTime: null }),
      makeInfo({ id: "b", startTime: now - 3000, endTime: null }),
    ]);

    const details = executeList(
      manager,
      { action: "list" },
      createNotificationRegistry(),
    );

    const durations = details.processes.map((p) => p.duration);
    expect(durations).toEqual(["3s", "3s"]);
  });

  it("never renders a negative duration for a freshly started process", () => {
    const now = 500;
    vi.setSystemTime(now);

    // startTime just ahead of `now` (clock skew / spawn race).
    const manager = makeManager([
      makeInfo({ startTime: now + 50, endTime: null, status: "running" }),
    ]);

    const details = executeList(
      manager,
      { action: "list" },
      createNotificationRegistry(),
    );

    expect(details.processes[0].duration).toBe("0s");
  });
});

describe("executeList watches", () => {
  it("includes current watches for live processes", () => {
    const manager = makeManager([makeInfo()]);
    const registry = createNotificationRegistry();
    registry.register("proc_1", {
      logMatches: [{ pattern: "ready" }, { pattern: "ERROR\nretry" }],
    });

    const details = executeList(manager, { action: "list" }, registry);

    expect(details.processes[0].watches).toEqual([
      { pattern: "ready" },
      { pattern: "ERROR\nretry" },
    ]);
    expect(formatListDetails(details)).toContain(
      'patterns=["ready","ERROR\\nretry"]',
    );
  });

  it("hides registered watches for finished processes", () => {
    const manager = makeManager([
      makeInfo({ status: "exited", success: true, endTime: 2000 }),
    ]);
    const registry = createNotificationRegistry();
    registry.register("proc_1", { logMatches: [{ pattern: "stale" }] });

    const details = executeList(manager, { action: "list" }, registry);

    expect(details.processes[0].watches).toEqual([]);
    expect(formatListDetails(details)).toContain("patterns=[]");
  });

  it("reflects append, replace, remove, and clear updates", () => {
    const process = makeInfo();
    const manager = makeManager([process]);
    const registry = createNotificationRegistry();
    registry.register(process.id, { logMatches: [{ pattern: "initial" }] });

    executeUpdate(
      {
        action: "update",
        id: process.id,
        watches: { mode: "append", items: [{ pattern: "appended" }] },
      },
      manager,
      registry,
    );
    expect(
      formatListDetails(executeList(manager, { action: "list" }, registry)),
    ).toContain('patterns=["initial","appended"]');

    executeUpdate(
      {
        action: "update",
        id: process.id,
        watches: {
          mode: "replace",
          items: [{ pattern: "first" }, { pattern: "second" }],
        },
      },
      manager,
      registry,
    );
    expect(
      formatListDetails(executeList(manager, { action: "list" }, registry)),
    ).toContain('patterns=["first","second"]');

    executeUpdate(
      {
        action: "update",
        id: process.id,
        watches: { mode: "remove", items: [{ index: 0 }] },
      },
      manager,
      registry,
    );
    expect(
      formatListDetails(executeList(manager, { action: "list" }, registry)),
    ).toContain('patterns=["second"]');

    executeUpdate(
      {
        action: "update",
        id: process.id,
        watches: { mode: "clear" },
      },
      manager,
      registry,
    );
    expect(
      formatListDetails(executeList(manager, { action: "list" }, registry)),
    ).toContain("patterns=[]");
  });
});
