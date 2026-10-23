import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { OrphanReapReport } from "../../../src/manager/orphan-recovery";
import { registerOrphanRecoveryHook } from "./orphan-recovery";

type NotifyFn = ReturnType<typeof vi.fn>;

type SessionStartHandler = (
  event: { type: "session_start" },
  ctx: { hasUI: boolean; ui: { notify: NotifyFn } },
) => void;

function makePi(): {
  pi: ExtensionAPI;
  start: SessionStartHandler;
  notify: NotifyFn;
} {
  let handler: SessionStartHandler | null = null;
  const notify = vi.fn();
  const pi = {
    on: vi.fn((event: string, cb: SessionStartHandler) => {
      if (event === "session_start") handler = cb;
    }),
  } as unknown as ExtensionAPI;
  return {
    pi,
    notify,
    start: (event, ctx) => {
      assert(handler, "session_start handler should be registered");
      handler(event, ctx);
    },
  };
}

function ctxWithUI(notify: NotifyFn) {
  return { hasUI: true, ui: { notify } };
}

function reportWith(killed: OrphanReapReport["killed"]): OrphanReapReport {
  return { killed, discarded: [], kept: 0 };
}

describe("registerOrphanRecoveryHook", () => {
  it("notifies about reaped orphan groups on session start", () => {
    const { pi, start, notify } = makePi();
    const reapOrphanedProcesses = vi.fn(() =>
      reportWith([
        { id: "proc_aa", name: "srv", command: "sleep 900", pid: 1234 },
        { id: "proc_bb", name: "build", command: "pnpm build", pid: 5678 },
      ]),
    );

    registerOrphanRecoveryHook(pi, {
      reapOrphanedProcesses,
    } as never);

    start({ type: "session_start" }, ctxWithUI(notify));

    expect(reapOrphanedProcesses).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const [message, level] = notify.mock.calls[0];
    expect(level).toBe("warning");
    expect(message).toContain("2 orphaned process groups");
    expect(message).toContain("srv (pid 1234): sleep 900");
    expect(message).toContain("build (pid 5678): pnpm build");
  });

  it("stays silent when nothing was reaped", () => {
    const { pi, start, notify } = makePi();
    const reapOrphanedProcesses = vi.fn(() => reportWith([]));

    registerOrphanRecoveryHook(pi, {
      reapOrphanedProcesses,
    } as never);

    start({ type: "session_start" }, ctxWithUI(notify));

    expect(notify).not.toHaveBeenCalled();
  });

  it("stays silent without a UI", () => {
    const { pi, start, notify } = makePi();
    const reapOrphanedProcesses = vi.fn(() =>
      reportWith([{ id: "proc_aa", name: "srv", command: "x", pid: 1 }]),
    );

    registerOrphanRecoveryHook(pi, {
      reapOrphanedProcesses,
    } as never);

    start({ type: "session_start" }, { hasUI: false, ui: { notify } });

    expect(notify).not.toHaveBeenCalled();
  });

  it("sanitizes untrusted record text in the notification", () => {
    const { pi, start, notify } = makePi();
    const reapOrphanedProcesses = vi.fn(() =>
      reportWith([
        {
          id: "proc_aa",
          name: "srv\u0007",
          command: "echo \u001b[2Jcleared",
          pid: 1234,
        },
      ]),
    );

    registerOrphanRecoveryHook(pi, {
      reapOrphanedProcesses,
    } as never);

    start({ type: "session_start" }, ctxWithUI(notify));

    const [message] = notify.mock.calls[0];
    expect(message).not.toContain("\u0007");
    expect(message).not.toContain("\u001b[2J");
    expect(message).toContain("cleared");
  });
});

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
