import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessManager } from "../../manager";
import { executeAction } from ".";
import { executeList } from "./list";
import { executeUpdate } from "./update";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("executeUpdate", () => {
  let manager: ProcessManager;

  afterEach(() => {
    manager.cleanup();
  });

  it("updates metadata and appends watches with agent guidance", () => {
    manager = new ProcessManager();
    const proc = manager.start("before", "cat", "/tmp");

    const result = executeUpdate(
      {
        id: proc.id,
        name: "after",
        alertOnSuccess: true,
        logWatchUpdate: {
          mode: "append",
          watches: [{ pattern: "ready" }],
        },
      },
      manager,
    );

    expect(result.details.success).toBe(true);
    expect(result.details.process?.name).toBe("after");
    expect(result.details.process?.alertOnSuccess).toBe(true);
    expect(result.details.watches).toMatchObject([
      { index: 0, pattern: "ready", stream: "both", repeat: false },
    ]);
    expect(result.content[0]?.text).toContain("Continue other work");
  });

  it("returns structured not-found errors", () => {
    manager = new ProcessManager();

    const result = executeUpdate({ id: "proc_missing" }, manager);

    expect(result.details.success).toBe(false);
    expect(result.details.action).toBe("update");
    expect(result.details.message).toMatch(/Process not found/);
  });

  it("shows monitoring state in process list output", () => {
    manager = new ProcessManager();
    manager.start("monitored", "cat", "/tmp", {
      alertOnFailure: true,
      logWatches: [{ pattern: "READY" }],
    });

    const result = executeList(manager);

    expect(result.content[0]?.text).toContain("[running; watch:1 alert:fail]");
    expect(result.details.processes?.[0]).toMatchObject({
      watchCount: 1,
      activeWatchCount: 1,
    });
  });

  it("returns bounded replay matches for newly added watches", async () => {
    manager = new ProcessManager();
    const proc = manager.start("replay", "cat", "/tmp");

    manager.writeToStdin(proc.id, "ignored\nready\n");
    await sleep(100);

    const result = executeUpdate(
      {
        id: proc.id,
        logWatchUpdate: {
          mode: "append",
          watches: [{ pattern: "ready" }],
          replayTailLines: 2,
          maxReplayMatches: 1,
        },
      },
      manager,
    );

    expect(result.details.success).toBe(true);
    expect(result.details.replayMatches).toMatchObject([
      { watchIndex: 0, source: "stdout", line: "ready" },
    ]);
    expect(result.details.watches).toMatchObject([{ index: 0, fired: true }]);
    expect(result.content[0]?.text).toContain("1 replay match");
  });

  it("is wired through the generic action dispatcher", async () => {
    manager = new ProcessManager();
    const proc = manager.start("dispatch", "cat", "/tmp");

    const result = await executeAction(
      { action: "update", id: proc.id, logWatchUpdate: { mode: "list" } },
      manager,
      { cwd: "/tmp" } as ExtensionContext,
    );

    expect(result.details.success).toBe(true);
    expect(result.details.action).toBe("update");
    expect(result.details.watches).toEqual([]);
  });
});
