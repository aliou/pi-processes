import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import { executeList } from ".";

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
  return { list: () => processes } as unknown as ProcessManager;
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

    const details = executeList(manager, { action: "list" });

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

    const details = executeList(manager, { action: "list" });

    expect(details.processes[0].duration).toBe("1m 30s");
  });

  it("uses a single reference time for all running processes", () => {
    const now = 2_000_000;
    vi.setSystemTime(now);

    const manager = makeManager([
      makeInfo({ id: "a", startTime: now - 3000, endTime: null }),
      makeInfo({ id: "b", startTime: now - 3000, endTime: null }),
    ]);

    const details = executeList(manager, { action: "list" });

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

    const details = executeList(manager, { action: "list" });

    expect(details.processes[0].duration).toBe("0s");
  });
});
