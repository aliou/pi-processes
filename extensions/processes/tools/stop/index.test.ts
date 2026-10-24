import { describe, expect, it, vi } from "vitest";

import { ProcessManager } from "../../../../src/manager";
import type { KillResult, ProcessInfo } from "../../../../src/types";
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

function createManager(kill: () => Promise<KillResult>): {
  manager: ProcessManager;
  kill: ReturnType<typeof vi.fn>;
} {
  const manager = new ProcessManager();
  const killSpy = vi.fn(kill);
  vi.spyOn(manager, "kill").mockImplementation(killSpy as never);
  return { manager, kill: killSpy };
}

describe("executeStop", () => {
  it("marks intentional stop before killing", async () => {
    const info = makeInfo();
    const { manager, kill } = createManager(async () => ({ ok: true, info }));

    await executeStop({ action: "stop", id: "proc_1" }, manager);

    expect(kill).toHaveBeenCalledWith("proc_1", undefined);
    manager.cleanup();
  });

  it("marks intentional stop in the manager before kill is called", async () => {
    let intentionalStopAtCallTime = false;

    const info = makeInfo();
    const { manager } = createManager(async () => {
      // At the time kill is called, the intentional stop should already be set
      intentionalStopAtCallTime = manager.consumeIntentionalStop("proc_1");
      return { ok: true, info } as KillResult;
    });

    await executeStop({ action: "stop", id: "proc_1" }, manager);

    expect(intentionalStopAtCallTime).toBe(true);
    manager.cleanup();
  });

  it("clears intentional stop marker on not_found failure", async () => {
    const info = makeInfo();
    const { manager } = createManager(async () => ({
      ok: false,
      info,
      reason: "not_found",
    }));

    await executeStop({ action: "stop", id: "proc_1" }, manager);

    // The intentional stop marker should be cleared since kill returned not_found
    expect(manager.consumeIntentionalStop("proc_1")).toBe(false);
    manager.cleanup();
  });

  it("clears intentional stop marker on error failure", async () => {
    const info = makeInfo();
    const { manager } = createManager(async () => ({
      ok: false,
      info,
      reason: "error",
    }));

    await executeStop({ action: "stop", id: "proc_1" }, manager);

    expect(manager.consumeIntentionalStop("proc_1")).toBe(false);
    manager.cleanup();
  });

  it("preserves intentional stop marker on timeout failure", async () => {
    const info = makeInfo();
    const { manager } = createManager(async () => ({
      ok: false,
      info,
      reason: "timeout",
    }));

    await executeStop({ action: "stop", id: "proc_1" }, manager);

    // Timeout is not an immediate failure; the marker should remain
    expect(manager.consumeIntentionalStop("proc_1")).toBe(true);
    manager.cleanup();
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
    const { manager } = createManager(async () => ({ ok: true, info }));

    await executeStop({ action: "stop", id: "proc_1" }, manager);

    expect(manager.consumeIntentionalStop("proc_1")).toBe(false);
    manager.cleanup();
  });

  it("clears intentional stop marker when manager.kill throws", async () => {
    const { manager } = createManager(async () => {
      throw new Error("unexpected failure");
    });

    await expect(
      executeStop({ action: "stop", id: "proc_1" }, manager),
    ).rejects.toThrow(/process stop failed/);

    expect(manager.consumeIntentionalStop("proc_1")).toBe(false);
    manager.cleanup();
  });

  it("preserves existing stop result behavior", async () => {
    const info = makeInfo();
    const { manager } = createManager(async () => ({ ok: true, info }));

    const result = await executeStop({ action: "stop", id: "proc_1" }, manager);

    expect(result.action).toBe("stop");
    expect(result.result.ok).toBe(true);
    expect(result.result.info.id).toBe("proc_1");
    manager.cleanup();
  });

  it("throws when id is missing", async () => {
    const manager = new ProcessManager();

    await expect(executeStop({ action: "stop" }, manager)).rejects.toThrow(
      /requires id/,
    );
    manager.cleanup();
  });
});
