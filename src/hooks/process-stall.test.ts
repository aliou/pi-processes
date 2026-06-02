import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedProcessesConfig } from "../config";
import type { ManagerEvent, ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { setupProcessStallHook } from "./process-stall";

interface SentMessage {
  // biome-ignore lint/suspicious/noExplicitAny: test capture
  message: any;
  // biome-ignore lint/suspicious/noExplicitAny: test capture
  options: any;
}

function makeHarness(stallConfig: {
  enabled: boolean;
  silenceSeconds: number;
}) {
  const listeners: Array<(e: ManagerEvent) => void> = [];
  const processMap = new Map<string, ProcessInfo>();

  const manager = {
    onEvent: (l: (e: ManagerEvent) => void) => {
      listeners.push(l);
      return () => {};
    },
    get: (id: string) => processMap.get(id) ?? null,
  } as unknown as ProcessManager;

  const sent: SentMessage[] = [];
  const shutdownListeners: Array<() => void> = [];

  const pi = {
    sendMessage: (message: unknown, options: unknown) => {
      sent.push({ message, options });
    },
    on: (event: string, listener: () => void) => {
      if (event === "session_shutdown") {
        shutdownListeners.push(listener);
      }
    },
  } as unknown as ExtensionAPI;

  const config = { stall: stallConfig } as ResolvedProcessesConfig;
  setupProcessStallHook(pi, manager, config);

  const emit = (e: ManagerEvent) => {
    for (const l of listeners) l(e);
  };

  const triggerShutdown = () => {
    for (const l of shutdownListeners) l();
  };

  return { emit, sent, processMap, triggerShutdown };
}

function startedEvent(id = "p1"): ManagerEvent {
  return {
    type: "process_started",
    info: { id } as ProcessInfo,
  };
}

function outputEvent(id = "p1"): ManagerEvent {
  return { type: "process_output_changed", id } as ManagerEvent;
}

function endedEvent(id = "p1"): ManagerEvent {
  return {
    type: "process_ended",
    info: { id } as ProcessInfo,
  };
}

function processInfo(id = "p1"): ProcessInfo {
  return {
    id,
    name: "test-server",
    command: "node server.js",
    pid: 1234,
    cwd: "/tmp",
    startTime: Date.now(),
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "",
    stderrFile: "",
    alertOnSuccess: false,
    alertOnFailure: true,
    alertOnKill: false,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("process-stall disabled", () => {
  it("does nothing when stall is disabled", () => {
    const { emit, sent } = makeHarness({
      enabled: false,
      silenceSeconds: 10,
    });

    emit(startedEvent());
    vi.advanceTimersByTime(30_000);

    expect(sent).toHaveLength(0);
  });
});

describe("process-stall detection", () => {
  it("sends stall alert after silence threshold", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    emit(startedEvent());
    vi.advanceTimersByTime(10_000);

    expect(sent).toHaveLength(1);
    expect(sent[0].message.details.kind).toBe("stalled");
    expect(sent[0].message.details.processId).toBe("p1");
    expect(sent[0].message.details.processName).toBe("test-server");
    expect(sent[0].message.details.silenceSeconds).toBe(10);
  });

  it("does not alert before the threshold", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    emit(startedEvent());
    vi.advanceTimersByTime(9_999);

    expect(sent).toHaveLength(0);
  });

  it("does not re-alert without intervening output", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    emit(startedEvent());
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);

    // No new output — advance further, no second alert.
    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(1);
  });
});

describe("process-stall timer reset", () => {
  it("resets timer on output", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    emit(startedEvent());

    // Output at t=6s resets the timer.
    vi.advanceTimersByTime(6_000);
    emit(outputEvent());

    // Original threshold (t=10s) passes — no alert because timer reset.
    vi.advanceTimersByTime(5_000); // now at t=11s
    expect(sent).toHaveLength(0);

    // New threshold (t=6s+10s=16s) fires.
    vi.advanceTimersByTime(5_000); // now at t=16s
    expect(sent).toHaveLength(1);
  });

  it("re-alerts after output follows a stall", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    emit(startedEvent());

    // First stall.
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);

    // New output resets the notified flag.
    emit(outputEvent());

    // Second stall.
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(2);
    expect(sent[1].message.details.kind).toBe("stalled");
  });
});

describe("process-stall cleanup", () => {
  it("clears state on process_ended", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    emit(startedEvent());

    // Process ends before threshold.
    vi.advanceTimersByTime(5_000);
    emit(endedEvent());

    // Past threshold — no alert.
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(0);
  });

  it("clears state on processes_changed when process is gone", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    emit(startedEvent());

    // Simulate clearFinished: remove from map, then emit.
    processMap.delete("p1");
    emit({ type: "processes_changed" });

    vi.advanceTimersByTime(15_000);
    expect(sent).toHaveLength(0);
  });

  it("clears all timers on session_shutdown", () => {
    const { emit, sent, processMap, triggerShutdown } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    processMap.set("p2", processInfo("p2"));
    emit(startedEvent("p1"));
    emit(startedEvent("p2"));

    triggerShutdown();

    vi.advanceTimersByTime(30_000);
    expect(sent).toHaveLength(0);
  });
});

describe("process-stall delivery", () => {
  it("delivers stall wakes as steer with triggerTurn", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo());
    emit(startedEvent());
    vi.advanceTimersByTime(10_000);

    expect(sent[0].options.triggerTurn).toBe(true);
    expect(sent[0].options.deliverAs).toBe("steer");
  });
});

describe("process-stall multi-process", () => {
  it("tracks stall independently per process", () => {
    const { emit, sent, processMap } = makeHarness({
      enabled: true,
      silenceSeconds: 10,
    });

    processMap.set("p1", processInfo("p1"));
    processMap.set("p2", processInfo("p2"));
    emit(startedEvent("p1"));
    emit(startedEvent("p2"));

    // Output on p2 at t=5s resets only p2's timer.
    vi.advanceTimersByTime(5_000);
    emit(outputEvent("p2"));

    // At t=10s, p1 stalls; p2 still within threshold.
    vi.advanceTimersByTime(5_000);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.details.processId).toBe("p1");

    // At t=15s, p2 stalls.
    vi.advanceTimersByTime(5_000);
    expect(sent).toHaveLength(2);
    expect(sent[1].message.details.processId).toBe("p2");
  });
});
