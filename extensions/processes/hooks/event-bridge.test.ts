import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import type { ManagerEvent, ProcessInfo } from "../../../src/types";
import { CHANNELS } from "../../shared/protocol";
import { registerEventBridge } from "./event-bridge";

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

function createFakeManager() {
  const listeners: Array<(event: ManagerEvent) => void> = [];

  return {
    manager: {
      onEvent(listener: (event: ManagerEvent) => void): () => void {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    } as unknown as ProcessManager,
    emit(event: ManagerEvent): void {
      for (const listener of listeners) listener(event);
    },
  };
}

describe("registerEventBridge", () => {
  it("bridges started events and changed notifications", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const started = vi.fn();
    const changed = vi.fn();

    events.on(CHANNELS.STARTED, started);
    events.on(CHANNELS.CHANGED, changed);
    registerEventBridge(events, fake.manager);

    const info = makeInfo();
    fake.emit({ type: "process_started", info });

    expect(started).toHaveBeenCalledWith(info);
    expect(changed).toHaveBeenCalledWith({ reason: "started" });
  });

  it("bridges ended and output events", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const ended = vi.fn();
    const output = vi.fn();

    events.on(CHANNELS.ENDED, ended);
    events.on(CHANNELS.OUTPUT_CHANGED, output);
    registerEventBridge(events, fake.manager);

    const info = makeInfo({ status: "exited", success: true, exitCode: 0 });
    const appendedText = [{ type: "stdout" as const, text: "ready" }];
    fake.emit({ type: "process_ended", info });
    fake.emit({
      type: "process_output_changed",
      id: "proc_1",
      appendedText,
      droppedLines: 3,
    });

    expect(ended).toHaveBeenCalledWith(info);
    expect(output).toHaveBeenCalledWith({
      id: "proc_1",
      appendedText,
      droppedLines: 3,
    });
  });

  it("bridges processes changed events", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const changed = vi.fn();

    events.on(CHANNELS.CHANGED, changed);
    registerEventBridge(events, fake.manager);

    fake.emit({ type: "processes_changed" });

    expect(changed).toHaveBeenCalledWith({ reason: "cleared" });
  });

  it("disposes manager listener", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const started = vi.fn();

    events.on(CHANNELS.STARTED, started);
    const dispose = registerEventBridge(events, fake.manager);
    dispose();

    fake.emit({ type: "process_started", info: makeInfo() });

    expect(started).not.toHaveBeenCalled();
  });
});
