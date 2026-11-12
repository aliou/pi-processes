import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { MESSAGE_TYPE_PROCESSES_STOPPED } from "../constants";
import {
  appendStoppedProcessesEntry,
  registerStoppedNoticeHook,
} from "./stopped-notice";

type BranchEntry = Record<string, unknown>;

function makePi(branch: BranchEntry[]) {
  const sendMessage = vi.fn();
  const getBranch = vi.fn(() => branch);
  const ctx = { sessionManager: { getBranch } };
  const pi = {
    on: vi.fn(
      (event: string, handler: (event: unknown, ctx: unknown) => void) => {
        if (event === "session_start") handler(undefined, ctx);
      },
    ),
    sendMessage,
  } as unknown as ExtensionAPI;
  return {
    pi,
    sendMessage,
    getBranch,
  };
}

function stoppedEntry(processes: unknown): BranchEntry {
  return {
    type: "custom",
    customType: MESSAGE_TYPE_PROCESSES_STOPPED,
    data: { processes },
  };
}

function stoppedMessage(): BranchEntry {
  return {
    type: "custom_message",
    customType: MESSAGE_TYPE_PROCESSES_STOPPED,
  };
}

function unrelatedEntry(): BranchEntry {
  return { type: "custom", customType: "other" };
}

describe("appendStoppedProcessesEntry", () => {
  it("appends the processes as a custom entry", () => {
    const appendEntry = vi.fn();
    const pi = { appendEntry } as unknown as ExtensionAPI;

    appendStoppedProcessesEntry(pi, [
      { name: "api-server", command: "npm run dev" },
    ]);

    expect(appendEntry).toHaveBeenCalledWith(MESSAGE_TYPE_PROCESSES_STOPPED, {
      processes: [{ name: "api-server", command: "npm run dev" }],
    });
  });

  it("swallows persistence failures", () => {
    const appendEntry = vi.fn(() => {
      throw new Error("disk full");
    });
    const pi = { appendEntry } as unknown as ExtensionAPI;

    expect(() =>
      appendStoppedProcessesEntry(pi, [
        { name: "api-server", command: "npm run dev" },
      ]),
    ).not.toThrow();
  });
});

describe("registerStoppedNoticeHook", () => {
  it("sends nothing when the branch has no stopped entry", () => {
    const { pi, sendMessage } = makePi([unrelatedEntry()]);

    registerStoppedNoticeHook(pi);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends one displayed, non-waking message with the stopped processes", () => {
    const { pi, sendMessage } = makePi([
      stoppedEntry([
        { name: "api-server", command: "npm run dev" },
        { name: "watcher", command: "node watcher.mjs" },
      ]),
    ]);

    registerStoppedNoticeHook(pi);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = sendMessage.mock.calls[0];
    expect(message.customType).toBe(MESSAGE_TYPE_PROCESSES_STOPPED);
    expect(message.display).toBe(true);
    expect(message.content).toContain("2 background processes");
    expect(message.details).toEqual({
      processes: [
        { name: "api-server", command: "npm run dev" },
        { name: "watcher", command: "node watcher.mjs" },
      ],
    });
    expect(options).toEqual({ triggerTurn: false });
  });

  it("sends nothing once a later stopped message consumed the entry", () => {
    const { pi, sendMessage } = makePi([
      stoppedEntry([{ name: "api-server", command: "npm run dev" }]),
      stoppedMessage(),
    ]);

    registerStoppedNoticeHook(pi);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("notifies again for an entry written after the last consuming message", () => {
    const { pi, sendMessage } = makePi([
      stoppedEntry([{ name: "old", command: "old" }]),
      stoppedMessage(),
      stoppedEntry([{ name: "api-server", command: "npm run dev" }]),
    ]);

    registerStoppedNoticeHook(pi);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0].details).toEqual({
      processes: [{ name: "api-server", command: "npm run dev" }],
    });
  });

  it("sends nothing for a malformed entry", () => {
    const { pi, sendMessage } = makePi([stoppedEntry([{ name: 42 }])]);

    registerStoppedNoticeHook(pi);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("reads the active branch, not the whole session tree", () => {
    const { pi, getBranch } = makePi([]);

    registerStoppedNoticeHook(pi);

    expect(getBranch).toHaveBeenCalled();
  });
});
