import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import { CHANNELS } from "../../../src/protocol";
import type { ManagerEvent, ProcessInfo } from "../../../src/types";
import { registerLogSubscriptions } from "./subscriptions";

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
  const manager = {
    get: vi.fn((id: string) => (id === "proc_1" ? makeInfo({ id }) : null)),
    getCombinedOutput: vi.fn(() => [{ type: "stdout", text: "initial" }]),
    onEvent(listener: (event: ManagerEvent) => void): () => void {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  } as unknown as ProcessManager;

  return {
    manager,
    emit(event: ManagerEvent): void {
      for (const listener of listeners) listener(event);
    },
  };
}

describe("registerLogSubscriptions", () => {
  it("subscribes and returns initial combined output", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const reply = vi.fn();

    registerLogSubscriptions(events, fake.manager);
    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "proc_1",
      tailLines: 50,
      reply,
    });

    expect(fake.manager.getCombinedOutput).toHaveBeenCalledWith("proc_1", 50);
    expect(reply).toHaveBeenCalledWith({
      ok: true,
      initialLines: [{ type: "stdout", text: "initial" }],
    });
  });

  it("rejects unknown processes", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const reply = vi.fn();

    registerLogSubscriptions(events, fake.manager);
    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "missing",
      reply,
    });

    expect(reply).toHaveBeenCalledWith({
      ok: false,
      error: "Process not found",
    });
  });

  it("rejects unavailable process logs", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const reply = vi.fn();

    vi.mocked(fake.manager.getCombinedOutput).mockReturnValue(null);

    registerLogSubscriptions(events, fake.manager);
    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "proc_1",
      reply,
    });

    expect(reply).toHaveBeenCalledWith({
      ok: false,
      error: "Process logs not found",
    });
  });

  it("ignores malformed subscription payloads", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const chunk = vi.fn();
    const appendedText = [{ type: "stdout" as const, text: "line" }];

    registerLogSubscriptions(events, fake.manager);
    events.on(CHANNELS.LOGS_CHUNK, chunk);
    events.emit(CHANNELS.LOGS_SUBSCRIBE, null);
    events.emit(CHANNELS.LOGS_SUBSCRIBE, { subscriberId: "sub_1" });
    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "proc_1",
      tailLines: "bad",
      reply: vi.fn(),
    });
    events.emit(CHANNELS.LOGS_UNSUBSCRIBE, null);
    events.emit(CHANNELS.LOGS_UNSUBSCRIBE, { processId: "proc_1" });
    fake.emit({ type: "process_output_changed", id: "proc_1", appendedText });

    expect(fake.manager.get).not.toHaveBeenCalled();
    expect(fake.manager.getCombinedOutput).not.toHaveBeenCalled();
    expect(chunk).not.toHaveBeenCalled();
  });

  it("emits chunks to matching subscribers only", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const chunk = vi.fn();
    const appendedText = [{ type: "stderr" as const, text: "line" }];

    registerLogSubscriptions(events, fake.manager);
    events.on(CHANNELS.LOGS_CHUNK, chunk);
    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "proc_1",
      reply: vi.fn(),
    });

    fake.emit({ type: "process_output_changed", id: "other", appendedText });
    fake.emit({ type: "process_output_changed", id: "proc_1", appendedText });

    expect(chunk).toHaveBeenCalledTimes(1);
    expect(chunk).toHaveBeenCalledWith({
      subscriberId: "sub_1",
      processId: "proc_1",
      lines: appendedText,
    });
  });

  it("purges subscribers when processes end or disappear", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const chunk = vi.fn();
    const appendedText = [{ type: "stdout" as const, text: "line" }];

    registerLogSubscriptions(events, fake.manager);
    events.on(CHANNELS.LOGS_CHUNK, chunk);
    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "proc_1",
      reply: vi.fn(),
    });
    fake.emit({ type: "process_ended", info: makeInfo({ id: "proc_1" }) });
    fake.emit({ type: "process_output_changed", id: "proc_1", appendedText });

    expect(chunk).not.toHaveBeenCalled();

    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "proc_1",
      reply: vi.fn(),
    });
    vi.mocked(fake.manager.get).mockReturnValue(null);
    fake.emit({ type: "processes_changed" });
    fake.emit({ type: "process_output_changed", id: "proc_1", appendedText });

    expect(chunk).not.toHaveBeenCalled();
  });

  it("unsubscribes and disposes subscriptions", () => {
    const events = createEventBus();
    const fake = createFakeManager();
    const chunk = vi.fn();
    const appendedText = [{ type: "stdout" as const, text: "line" }];

    const dispose = registerLogSubscriptions(events, fake.manager);
    events.on(CHANNELS.LOGS_CHUNK, chunk);
    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "proc_1",
      reply: vi.fn(),
    });
    events.emit(CHANNELS.LOGS_UNSUBSCRIBE, { subscriberId: "sub_1" });
    fake.emit({ type: "process_output_changed", id: "proc_1", appendedText });

    expect(chunk).not.toHaveBeenCalled();

    events.emit(CHANNELS.LOGS_SUBSCRIBE, {
      subscriberId: "sub_1",
      processId: "proc_1",
      reply: vi.fn(),
    });
    dispose();
    fake.emit({ type: "process_output_changed", id: "proc_1", appendedText });

    expect(chunk).not.toHaveBeenCalled();
  });
});
