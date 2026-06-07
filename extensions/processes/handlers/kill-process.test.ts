import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import type { KillResult, ProcessInfo } from "../../../src/types";
import { createNotificationRegistry } from "../notifications/registry";
import { killIntentionally } from "./kill-process";

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

describe("killIntentionally", () => {
  it("marks intentional stop before killing", async () => {
    const registry = createNotificationRegistry();
    let markedBeforeKill = false;
    const kill = vi.fn(async () => {
      markedBeforeKill = registry.consumeIntentionalStop("proc_1");
      return { ok: true, info: makeInfo() } as KillResult;
    });
    const manager = { kill } as unknown as ProcessManager;

    await killIntentionally(manager, registry, "proc_1", { signal: "SIGKILL" });

    expect(markedBeforeKill).toBe(true);
    expect(kill).toHaveBeenCalledWith("proc_1", { signal: "SIGKILL" });
  });

  it("clears marker on not_found and error failures", async () => {
    const cases: Array<KillResult & { ok: false }> = [
      { ok: false, reason: "not_found", info: makeInfo() },
      { ok: false, reason: "error", info: makeInfo() },
    ];

    for (const result of cases) {
      const registry = createNotificationRegistry();
      const manager = {
        kill: vi.fn(async () => result),
      } as unknown as ProcessManager;

      await killIntentionally(manager, registry, "proc_1");

      expect(registry.consumeIntentionalStop("proc_1")).toBe(false);
    }
  });

  it("preserves marker on timeout failure", async () => {
    const registry = createNotificationRegistry();
    const manager = {
      kill: vi.fn(
        async () =>
          ({ ok: false, reason: "timeout", info: makeInfo() }) as KillResult,
      ),
    } as unknown as ProcessManager;

    await killIntentionally(manager, registry, "proc_1");

    expect(registry.consumeIntentionalStop("proc_1")).toBe(true);
  });

  it("clears marker for already-finished successful kill result", async () => {
    const registry = createNotificationRegistry();
    const manager = {
      kill: vi.fn(
        async () =>
          ({
            ok: true,
            info: makeInfo({ status: "exited", success: true }),
          }) as KillResult,
      ),
    } as unknown as ProcessManager;

    await killIntentionally(manager, registry, "proc_1");

    expect(registry.consumeIntentionalStop("proc_1")).toBe(false);
  });

  it("clears marker when kill throws", async () => {
    const registry = createNotificationRegistry();
    const manager = {
      kill: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as ProcessManager;

    await expect(
      killIntentionally(manager, registry, "proc_1"),
    ).rejects.toThrow(/process stop failed/);
    expect(registry.consumeIntentionalStop("proc_1")).toBe(false);
  });
});
