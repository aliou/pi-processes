import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import type { ProcessListEntry } from "../../../src/wake";
import { CHANNELS } from "../../shared/protocol";
import type { ProcessProtocolConfig } from "../config";
import { DEFAULT_CONFIG } from "../config";
import { registerRequestHandlers } from "./requests";

const getConfig = () => DEFAULT_CONFIG;

function makeEntry(
  overrides: Partial<ProcessListEntry> = {},
): ProcessListEntry {
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
    const info = makeEntry();
    const manager = {
      listWithWake: vi.fn(() => [info]),
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

    registerRequestHandlers(events, manager, getConfig);

    const listReply = vi.fn();
    events.emit(CHANNELS.REQUEST_LIST, { reply: listReply });
    expect(listReply).toHaveBeenCalledWith([info]);
    expect(manager.listWithWake).toHaveBeenCalledTimes(1);

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

  it("replies with the manager's wake-annotated list without per-entry work in the handler", () => {
    const events = createEventBus();
    const running = makeEntry({
      wake: {
        exitAttention: { success: "turn", failure: "turn", killed: "context" },
        watches: [
          {
            pattern: "ready",
            mode: "literal",
            stream: "both",
            repeat: false,
            on: "turn",
            fired: true,
          },
        ],
      },
    });
    const ended = makeEntry({
      id: "proc_2",
      status: "exited",
      endTime: 2000,
    });
    const manager = {
      listWithWake: vi.fn(() => [running, ended]),
    } as unknown as ProcessManager;

    registerRequestHandlers(events, manager, getConfig);

    const reply = vi.fn();
    events.emit(CHANNELS.REQUEST_LIST, { reply });

    expect(reply).toHaveBeenCalledTimes(1);
    const processes = reply.mock.calls[0][0];
    expect(processes).toEqual([running, ended]);
    expect(processes[0].wake?.watches[0]).toMatchObject({
      pattern: "ready",
      fired: true,
    });
    expect("wake" in processes[1]).toBe(false);
  });

  it("replies with loaded config", () => {
    const events = createEventBus();
    const manager = {} as ProcessManager;
    const config: ProcessProtocolConfig = {
      ...DEFAULT_CONFIG,
      execution: { shellPath: "/bin/bash" },
    };
    const reply = vi.fn();

    registerRequestHandlers(events, manager, () => config);
    events.emit(CHANNELS.REQUEST_CONFIG, { reply });

    expect(reply).toHaveBeenCalledWith(config);
  });

  it("disposes event listeners", () => {
    const events = createEventBus();
    const manager = {
      listWithWake: vi.fn(() => []),
    } as unknown as ProcessManager;
    const reply = vi.fn();

    const dispose = registerRequestHandlers(events, manager, getConfig);
    dispose();
    events.emit(CHANNELS.REQUEST_LIST, { reply });

    expect(reply).not.toHaveBeenCalled();
  });
});
