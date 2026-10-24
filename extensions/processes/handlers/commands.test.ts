import type { ChildProcess } from "node:child_process";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { ProcessManager } from "../../../src/manager";
import type { KillResult, ProcessInfo } from "../../../src/types";
import { CHANNELS } from "../../shared/protocol";
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

function createManager(
  overrides: Partial<Record<keyof ProcessManager, unknown>>,
): ProcessManager {
  const manager = new ProcessManager();
  for (const [method, impl] of Object.entries(overrides)) {
    vi.spyOn(manager, method as keyof ProcessManager).mockImplementation(
      impl as never,
    );
  }
  return manager;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("registerCommandHandlers", () => {
  it("kills processes as intentional stops", async () => {
    const events = createEventBus();
    const result: KillResult = { ok: true, info: makeInfo() };
    let markedBeforeKill = false;
    const manager = createManager({
      kill: async () => {
        markedBeforeKill = manager.consumeIntentionalStop("proc_1");
        return result;
      },
    });
    const reply = vi.fn();

    registerCommandHandlers(events, manager);
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
    manager.cleanup();
  });

  it("replies with error result when kill throws", async () => {
    const events = createEventBus();
    const manager = createManager({
      kill: async () => {
        throw new Error("boom");
      },
    });
    const reply = vi.fn();

    registerCommandHandlers(events, manager);
    events.emit(CHANNELS.COMMAND_KILL, { id: "proc_1", reply });
    await flushPromises();

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        reason: "error",
        info: expect.objectContaining({ id: "proc_1" }),
      }),
    );
    expect(manager.consumeIntentionalStop("proc_1")).toBe(false);
    manager.cleanup();
  });

  it("clears finished processes", () => {
    const events = createEventBus();
    const manager = createManager({
      clearFinished: () => 2,
    });
    const reply = vi.fn();

    registerCommandHandlers(events, manager);
    events.emit(CHANNELS.COMMAND_CLEAR, { reply });

    expect(reply).toHaveBeenCalledWith(2);
    manager.cleanup();
  });

  it("adopts external children with default notifications", () => {
    const events = createEventBus();
    const child = { pid: 123 } as ChildProcess;
    const info = makeInfo({ status: "running", endTime: null, success: null });
    const manager = createManager({
      adopt: () => info,
    });
    const reply = vi.fn();

    registerCommandHandlers(events, manager);
    events.emit(CHANNELS.COMMAND_ADOPT, {
      name: "grep",
      command: "grep -R needle .",
      cwd: "/repo",
      child,
      initialStdout: Buffer.from("partial output\n"),
      initialStderr: Buffer.from("early stderr\n"),
      startTime: 1000,
      reply,
    });

    expect(manager.adopt).toHaveBeenCalledWith(
      "grep",
      "grep -R needle .",
      "/repo",
      child,
      {
        initialStdout: Buffer.from("partial output\n"),
        initialStderr: Buffer.from("early stderr\n"),
        startTime: 1000,
      },
    );
    expect(manager.getWakeConfig(info.id)).toEqual({});
    expect(reply).toHaveBeenCalledWith({ ok: true, info });
    manager.cleanup();
  });

  it("swallows requester reply errors", async () => {
    const events = createEventBus();
    const manager = createManager({
      kill: async () => ({ ok: true, info: makeInfo() }) as KillResult,
      clearFinished: () => 1,
    });
    const throwingReply = vi.fn(() => {
      throw new Error("bad requester");
    });

    registerCommandHandlers(events, manager);

    expect(() => {
      events.emit(CHANNELS.COMMAND_CLEAR, { reply: throwingReply });
    }).not.toThrow();

    events.emit(CHANNELS.COMMAND_KILL, { id: "proc_1", reply: throwingReply });
    await flushPromises();

    expect(throwingReply).toHaveBeenCalledTimes(2);
    manager.cleanup();
  });

  it("disposes event listeners", async () => {
    const events = createEventBus();
    const manager = createManager({
      kill: async () => ({ ok: true, info: makeInfo() }) as KillResult,
    });
    const reply = vi.fn();

    const dispose = registerCommandHandlers(events, manager);
    dispose();
    events.emit(CHANNELS.COMMAND_KILL, { id: "proc_1", reply });
    await flushPromises();

    expect(reply).not.toHaveBeenCalled();
    manager.cleanup();
  });
});
