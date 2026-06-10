import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import { CHANNELS } from "../../../src/protocol";
import type { ProcessInfo } from "../../../src/types";
import { registerRequestHandlers } from "./requests";

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

describe("registerRequestHandlers", () => {
  it("replies to manager read requests", () => {
    const events = createEventBus();
    const info = makeInfo();
    const manager = {
      list: vi.fn(() => [info]),
      get: vi.fn(() => info),
      getOutput: vi.fn(() => ({
        stdout: ["out"],
        stderr: ["err"],
        status: "running",
      })),
      getCombinedOutput: vi.fn(() => [{ type: "stdout", text: "out" }]),
      getLogFiles: vi.fn(() => ({
        stdoutFile: "/tmp/stdout.log",
        stderrFile: "/tmp/stderr.log",
        combinedFile: "/tmp/combined.log",
      })),
      getFileSize: vi.fn(() => ({ stdout: 1, stderr: 2 })),
    } as unknown as ProcessManager;

    registerRequestHandlers(events, manager);

    const listReply = vi.fn();
    events.emit(CHANNELS.REQUEST_LIST, { reply: listReply });
    expect(listReply).toHaveBeenCalledWith([info]);

    const getReply = vi.fn();
    events.emit(CHANNELS.REQUEST_GET, { id: "proc_1", reply: getReply });
    expect(getReply).toHaveBeenCalledWith(info);

    const outputReply = vi.fn();
    events.emit(CHANNELS.REQUEST_OUTPUT, {
      id: "proc_1",
      tailLines: 5,
      reply: outputReply,
    });
    expect(manager.getOutput).toHaveBeenCalledWith("proc_1", 5);
    expect(outputReply).toHaveBeenCalledWith({
      stdout: ["out"],
      stderr: ["err"],
      status: "running",
    });

    const combinedReply = vi.fn();
    events.emit(CHANNELS.REQUEST_COMBINED_OUTPUT, {
      id: "proc_1",
      tailLines: 3,
      reply: combinedReply,
    });
    expect(manager.getCombinedOutput).toHaveBeenCalledWith("proc_1", 3);
    expect(combinedReply).toHaveBeenCalledWith([
      { type: "stdout", text: "out" },
    ]);

    const logsReply = vi.fn();
    events.emit(CHANNELS.REQUEST_LOG_FILES, {
      id: "proc_1",
      reply: logsReply,
    });
    expect(logsReply).toHaveBeenCalledWith({
      stdoutFile: "/tmp/stdout.log",
      stderrFile: "/tmp/stderr.log",
      combinedFile: "/tmp/combined.log",
    });

    const sizeReply = vi.fn();
    events.emit(CHANNELS.REQUEST_FILE_SIZE, {
      id: "proc_1",
      reply: sizeReply,
    });
    expect(sizeReply).toHaveBeenCalledWith({ stdout: 1, stderr: 2 });
  });

  it("replies with temporary empty config", () => {
    const events = createEventBus();
    const manager = {} as ProcessManager;
    const reply = vi.fn();

    registerRequestHandlers(events, manager);
    events.emit(CHANNELS.REQUEST_CONFIG, { reply });

    expect(reply).toHaveBeenCalledWith({});
  });

  it("ignores malformed request payloads", () => {
    const events = createEventBus();
    const manager = {
      list: vi.fn(() => []),
      get: vi.fn(() => null),
      getOutput: vi.fn(() => null),
      getCombinedOutput: vi.fn(() => null),
      getLogFiles: vi.fn(() => null),
      getFileSize: vi.fn(() => null),
    } as unknown as ProcessManager;

    registerRequestHandlers(events, manager);
    events.emit(CHANNELS.REQUEST_LIST, null);
    events.emit(CHANNELS.REQUEST_LIST, {});
    events.emit(CHANNELS.REQUEST_GET, { id: 123, reply: vi.fn() });
    events.emit(CHANNELS.REQUEST_OUTPUT, {
      id: "proc_1",
      tailLines: "bad",
      reply: vi.fn(),
    });
    events.emit(CHANNELS.REQUEST_COMBINED_OUTPUT, {
      id: "proc_1",
      tailLines: Number.NaN,
      reply: vi.fn(),
    });
    events.emit(CHANNELS.REQUEST_LOG_FILES, { id: "proc_1" });
    events.emit(CHANNELS.REQUEST_FILE_SIZE, { reply: vi.fn() });
    events.emit(CHANNELS.REQUEST_CONFIG, null);

    expect(manager.list).not.toHaveBeenCalled();
    expect(manager.get).not.toHaveBeenCalled();
    expect(manager.getOutput).not.toHaveBeenCalled();
    expect(manager.getCombinedOutput).not.toHaveBeenCalled();
    expect(manager.getLogFiles).not.toHaveBeenCalled();
    expect(manager.getFileSize).not.toHaveBeenCalled();
  });

  it("disposes event listeners", () => {
    const events = createEventBus();
    const manager = { list: vi.fn(() => []) } as unknown as ProcessManager;
    const reply = vi.fn();

    const dispose = registerRequestHandlers(events, manager);
    dispose();
    events.emit(CHANNELS.REQUEST_LIST, { reply });

    expect(reply).not.toHaveBeenCalled();
  });
});
