import { describe, expect, it, vi } from "vitest";

import { ProcessManager } from "../../../src/manager";
import type { KillResult, ProcessInfo } from "../../../src/types";
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

function createManager(kill: () => Promise<KillResult>): ProcessManager {
  const manager = new ProcessManager();
  vi.spyOn(manager, "kill").mockImplementation(kill);
  return manager;
}

describe("killIntentionally", () => {
  it("marks intentional stop before killing", async () => {
    let markedBeforeKill = false;
    const manager = createManager(async () => {
      markedBeforeKill = manager.consumeIntentionalStop("proc_1");
      return { ok: true, info: makeInfo() } as KillResult;
    });

    await killIntentionally(manager, "proc_1", { signal: "SIGKILL" });

    expect(markedBeforeKill).toBe(true);
    expect(manager.kill).toHaveBeenCalledWith("proc_1", { signal: "SIGKILL" });
    manager.cleanup();
  });

  it("clears marker on not_found and error failures", async () => {
    const cases: Array<KillResult & { ok: false }> = [
      { ok: false, reason: "not_found", info: makeInfo() },
      { ok: false, reason: "error", info: makeInfo() },
    ];

    for (const result of cases) {
      const manager = createManager(async () => result);

      await killIntentionally(manager, "proc_1");

      expect(manager.consumeIntentionalStop("proc_1")).toBe(false);
      manager.cleanup();
    }
  });

  it("preserves marker on timeout failure", async () => {
    const manager = createManager(
      async () =>
        ({ ok: false, reason: "timeout", info: makeInfo() }) as KillResult,
    );

    await killIntentionally(manager, "proc_1");

    expect(manager.consumeIntentionalStop("proc_1")).toBe(true);
    manager.cleanup();
  });

  it("clears marker for already-finished successful kill result", async () => {
    const manager = createManager(
      async () =>
        ({
          ok: true,
          info: makeInfo({ status: "exited", success: true }),
        }) as KillResult,
    );

    await killIntentionally(manager, "proc_1");

    expect(manager.consumeIntentionalStop("proc_1")).toBe(false);
    manager.cleanup();
  });

  it("clears marker when kill throws", async () => {
    const manager = createManager(async () => {
      throw new Error("boom");
    });

    await expect(killIntentionally(manager, "proc_1")).rejects.toThrow(
      /process stop failed/,
    );
    expect(manager.consumeIntentionalStop("proc_1")).toBe(false);
    manager.cleanup();
  });
});
