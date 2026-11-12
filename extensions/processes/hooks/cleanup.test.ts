import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { MESSAGE_TYPE_PROCESSES_STOPPED } from "../constants";
import { createNotificationRegistry } from "../notifications/registry";
import { registerCleanupHook } from "./cleanup";

function makePi(overrides: Record<string, unknown> = {}) {
  let shutdown: () => Promise<void> | void = () => {
    throw new Error("shutdown handler was not registered");
  };
  const pi = {
    on: vi.fn((event: string, handler: () => Promise<void> | void) => {
      if (event === "session_shutdown") shutdown = handler;
    }),
    ...overrides,
  } as unknown as ExtensionAPI;
  return { pi, runShutdown: () => shutdown() };
}

function makeDeps(
  list: Array<{ status: string; name: string; command: string }>,
  calls: string[],
) {
  return {
    manager: {
      list: vi.fn(() => list),
      killAll: vi.fn(() => calls.push("killAll")),
      cleanup: vi.fn(() => calls.push("cleanup")),
    },
    notifications: createNotificationRegistry(),
    notificationService: {
      dispose: vi.fn(() => calls.push("notificationService.dispose")),
    },
  };
}

describe("registerCleanupHook", () => {
  it("runs disposers before manager cleanup and ignores duplicate shutdown", async () => {
    const calls: string[] = [];
    const { pi, runShutdown } = makePi();
    const manager = {
      list: vi.fn(() => []),
      killAll: vi.fn(() => calls.push("killAll")),
      cleanup: vi.fn(() => calls.push("cleanup")),
    };
    const notificationService = {
      dispose: vi.fn(() => calls.push("notificationService.dispose")),
    };
    const notifications = createNotificationRegistry();
    const disposer = vi.fn(() => calls.push("disposer"));

    registerCleanupHook(pi, {
      manager: manager as never,
      notifications,
      notificationService,
      disposers: [disposer],
    });

    await runShutdown();
    await runShutdown();

    expect(disposer).toHaveBeenCalledTimes(1);
    expect(notificationService.dispose).toHaveBeenCalledTimes(1);
    expect(manager.killAll).toHaveBeenCalledTimes(1);
    expect(manager.cleanup).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "disposer",
      "notificationService.dispose",
      "killAll",
      "cleanup",
    ]);
  });

  it("records live processes in a custom entry before killing them", async () => {
    const calls: string[] = [];
    const appendEntry = vi.fn(() => calls.push("appendEntry"));
    const { pi, runShutdown } = makePi({ appendEntry });
    const deps = makeDeps(
      [
        {
          status: "running",
          name: "api-server",
          command: "npm run dev",
        },
        {
          status: "exited",
          name: "old-job",
          command: "sleep 1",
        },
      ],
      calls,
    );

    registerCleanupHook(pi, {
      ...deps,
      manager: deps.manager as never,
      notificationService: deps.notificationService as never,
    } as never);

    await runShutdown();

    expect(appendEntry).toHaveBeenCalledWith(MESSAGE_TYPE_PROCESSES_STOPPED, {
      processes: [{ name: "api-server", command: "npm run dev" }],
    });
    expect(calls).toEqual([
      "notificationService.dispose",
      "appendEntry",
      "killAll",
      "cleanup",
    ]);
  });

  it("records no entry when no process is live", async () => {
    const calls: string[] = [];
    const appendEntry = vi.fn();
    const { pi, runShutdown } = makePi({ appendEntry });
    const deps = makeDeps(
      [{ status: "exited", name: "old-job", command: "sleep 1" }],
      calls,
    );

    registerCleanupHook(pi, {
      ...deps,
      manager: deps.manager as never,
      notificationService: deps.notificationService as never,
    } as never);

    await runShutdown();

    expect(appendEntry).not.toHaveBeenCalled();
    expect(deps.manager.killAll).toHaveBeenCalledTimes(1);
  });

  it("still kills processes when the entry cannot be persisted", async () => {
    const calls: string[] = [];
    const appendEntry = vi.fn(() => {
      throw new Error("disk full");
    });
    const { pi, runShutdown } = makePi({ appendEntry });
    const deps = makeDeps(
      [{ status: "running", name: "api-server", command: "npm run dev" }],
      calls,
    );

    registerCleanupHook(pi, {
      ...deps,
      manager: deps.manager as never,
      notificationService: deps.notificationService as never,
    } as never);

    await runShutdown();

    expect(deps.manager.killAll).toHaveBeenCalledTimes(1);
    expect(deps.manager.cleanup).toHaveBeenCalledTimes(1);
  });
});
