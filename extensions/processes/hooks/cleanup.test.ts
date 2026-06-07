import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { createNotificationRegistry } from "../notifications/registry";
import { registerCleanupHook } from "./cleanup";

describe("registerCleanupHook", () => {
  it("runs disposers before manager cleanup and ignores duplicate shutdown", async () => {
    let shutdown: () => Promise<void> | void = () => {
      throw new Error("shutdown handler was not registered");
    };
    const calls: string[] = [];
    const pi = {
      on: vi.fn((event: string, handler: () => Promise<void> | void) => {
        if (event === "session_shutdown") shutdown = handler;
      }),
    } as unknown as ExtensionAPI;
    const manager = {
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

    await shutdown();
    await shutdown();

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
});
