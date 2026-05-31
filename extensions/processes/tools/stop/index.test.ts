import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { KillResult, ProcessInfo } from "../../../../src/types";
import { createNotificationRegistry } from "../../notifications/registry";
import { executeStop } from ".";

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

describe("executeStop", () => {
  it("marks intentional stop before killing", async () => {
    const info = makeInfo();
    const kill = vi.fn(async () => ({ ok: true, info }) as KillResult);
    const manager = { kill } as unknown as ProcessManager;
    const registry = createNotificationRegistry();

    registry.register("proc_1", {});

    await executeStop({ action: "stop", id: "proc_1" }, manager, registry);

    expect(kill).toHaveBeenCalledWith("proc_1");
  });

  it("marks intentional stop in registry before manager.kill is called", async () => {
    let intentionalStopAtCallTime = false;

    const info = makeInfo();
    const kill = vi.fn(async () => {
      // At the time kill is called, the intentional stop should already be set
      intentionalStopAtCallTime = registry.consumeIntentionalStop("proc_1");
      return { ok: true, info } as KillResult;
    });
    const manager = { kill } as unknown as ProcessManager;
    const registry = createNotificationRegistry();
    registry.register("proc_1", {});

    await executeStop({ action: "stop", id: "proc_1" }, manager, registry);

    expect(intentionalStopAtCallTime).toBe(true);
  });

  it("clears intentional stop marker on not_found failure", async () => {
    const info = makeInfo();
    const kill = vi.fn(
      async () =>
        ({
          ok: false,
          info,
          reason: "not_found",
        }) as KillResult,
    );
    const manager = { kill } as unknown as ProcessManager;
    const registry = createNotificationRegistry();

    await executeStop({ action: "stop", id: "proc_1" }, manager, registry);

    // The intentional stop marker should be cleared since kill returned not_found
    expect(registry.consumeIntentionalStop("proc_1")).toBe(false);
  });

  it("clears intentional stop marker on error failure", async () => {
    const info = makeInfo();
    const kill = vi.fn(
      async () =>
        ({
          ok: false,
          info,
          reason: "error",
        }) as KillResult,
    );
    const manager = { kill } as unknown as ProcessManager;
    const registry = createNotificationRegistry();

    await executeStop({ action: "stop", id: "proc_1" }, manager, registry);

    expect(registry.consumeIntentionalStop("proc_1")).toBe(false);
  });

  it("preserves intentional stop marker on timeout failure", async () => {
    const info = makeInfo();
    const kill = vi.fn(
      async () =>
        ({
          ok: false,
          info,
          reason: "timeout",
        }) as KillResult,
    );
    const manager = { kill } as unknown as ProcessManager;
    const registry = createNotificationRegistry();

    await executeStop({ action: "stop", id: "proc_1" }, manager, registry);

    // Timeout is not an immediate failure; the marker should remain
    expect(registry.consumeIntentionalStop("proc_1")).toBe(true);
  });

  it("clears intentional stop marker when kill returns ok for already-finished process", async () => {
    // manager.kill() returns ok:true with status:"exited" for non-live processes
    // No process_ended event will fire, so the marker must be cleared here
    const info = makeInfo({
      status: "exited",
      endReason: "exit",
      exitCode: 0,
      success: true,
    });
    const kill = vi.fn(async () => ({ ok: true, info }) as KillResult);
    const manager = { kill } as unknown as ProcessManager;
    const registry = createNotificationRegistry();

    await executeStop({ action: "stop", id: "proc_1" }, manager, registry);

    expect(registry.consumeIntentionalStop("proc_1")).toBe(false);
  });

  it("clears intentional stop marker when manager.kill throws", async () => {
    const kill = vi.fn(async () => {
      throw new Error("unexpected failure");
    });
    const manager = { kill } as unknown as ProcessManager;
    const registry = createNotificationRegistry();

    await expect(
      executeStop({ action: "stop", id: "proc_1" }, manager, registry),
    ).rejects.toThrow(/process stop failed/);

    expect(registry.consumeIntentionalStop("proc_1")).toBe(false);
  });

  it("preserves existing stop result behavior", async () => {
    const info = makeInfo();
    const kill = vi.fn(async () => ({ ok: true, info }) as KillResult);
    const manager = { kill } as unknown as ProcessManager;
    const registry = createNotificationRegistry();

    const result = await executeStop(
      { action: "stop", id: "proc_1" },
      manager,
      registry,
    );

    expect(result.action).toBe("stop");
    expect(result.result.ok).toBe(true);
    expect(result.result.info.id).toBe("proc_1");
  });

  it("throws when id is missing", async () => {
    const manager = { kill: vi.fn() } as unknown as ProcessManager;
    const registry = createNotificationRegistry();

    await expect(
      executeStop({ action: "stop" }, manager, registry),
    ).rejects.toThrow(/requires id/);
  });
});
