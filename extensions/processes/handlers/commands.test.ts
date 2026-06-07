import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import { CHANNELS } from "../../../src/protocol";
import type { KillResult, ProcessInfo } from "../../../src/types";
import { createNotificationRegistry } from "../notifications/registry";
import { registerCommandHandlers } from "./commands";

function makeInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "dev",
    pid: 123,
    command: "pnpm dev",
    cwd: "/repo",
    startTime: 1000,
    endTime: 2000,
    status: "killed",
    exitCode: null,
    success: false,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: "signal",
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("registerCommandHandlers", () => {
  it("kills processes as intentional stops", async () => {
    const events = createEventBus();
    const registry = createNotificationRegistry();
    const result: KillResult = { ok: true, info: makeInfo() };
    let markedBeforeKill = false;
    const manager = {
      kill: vi.fn(async () => {
        markedBeforeKill = registry.consumeIntentionalStop("proc_1");
        return result;
      }),
    } as unknown as ProcessManager;
    const reply = vi.fn();

    registerCommandHandlers(events, manager, registry);
    events.emit(CHANNELS.COMMAND_KILL, {
      id: "proc_1",
      signal: "SIGKILL",
      timeoutMs: 100,
      reply,
    });
    await flushPromises();

    expect(markedBeforeKill).toBe(true);
    expect(manager.kill).toHaveBeenCalledWith("proc_1", {
      signal: "SIGKILL",
      timeoutMs: 100,
    });
    expect(reply).toHaveBeenCalledWith(result);
  });

  it("replies with error result when kill throws", async () => {
    const events = createEventBus();
    const registry = createNotificationRegistry();
    const manager = {
      kill: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as ProcessManager;
    const reply = vi.fn();

    registerCommandHandlers(events, manager, registry);
    events.emit(CHANNELS.COMMAND_KILL, { id: "proc_1", reply });
    await flushPromises();

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        reason: "error",
        info: expect.objectContaining({ id: "proc_1" }),
      }),
    );
    expect(registry.consumeIntentionalStop("proc_1")).toBe(false);
  });

  it("clears finished processes", () => {
    const events = createEventBus();
    const registry = createNotificationRegistry();
    const manager = {
      clearFinished: vi.fn(() => 2),
    } as unknown as ProcessManager;
    const reply = vi.fn();

    registerCommandHandlers(events, manager, registry);
    events.emit(CHANNELS.COMMAND_CLEAR, { reply });

    expect(reply).toHaveBeenCalledWith(2);
  });

  it("disposes event listeners", async () => {
    const events = createEventBus();
    const registry = createNotificationRegistry();
    const manager = {
      kill: vi.fn(async () => ({ ok: true, info: makeInfo() }) as KillResult),
    } as unknown as ProcessManager;
    const reply = vi.fn();

    const dispose = registerCommandHandlers(events, manager, registry);
    dispose();
    events.emit(CHANNELS.COMMAND_KILL, { id: "proc_1", reply });
    await flushPromises();

    expect(reply).not.toHaveBeenCalled();
  });
});
