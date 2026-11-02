// Regression: process start reported an already-exited process as running (#150).
import { expect } from "vitest";
import { ProcessManager } from "../../src/manager";
import { test } from "./fixtures";
import { collectEvents } from "./utils";

test("reports an immediate crash in the start result", async ({ cwd }) => {
  using manager = new ProcessManager({ startExitGraceMs: 8_000 });
  const events = collectEvents(manager);

  const info = await manager.start("quick-fail", "exit 7", cwd);

  expect(info).toEqual(
    expect.objectContaining({
      name: "quick-fail",
      status: "exited",
      exitCode: 7,
      success: false,
      endReason: "exit",
    }),
  );
  expect(info.endTime).not.toBeNull();

  const ended = events.filter((event) => event.type === "process_ended");
  expect(ended).toHaveLength(1);
});

test("reports an immediate spawn failure in the start result", async ({
  cwd,
}) => {
  using manager = new ProcessManager({ startExitGraceMs: 8_000 });

  const info = await manager.start("missing-cwd", "true", `${cwd}/missing`);

  expect(info).toEqual(
    expect.objectContaining({
      name: "missing-cwd",
      status: "exited",
      success: false,
    }),
  );
  expect(["missing_pid", "spawn_error"]).toContain(info.endReason);
});

test("keeps healthy long-running starts fast and running", async ({
  cwd,
  addScript,
}) => {
  using manager = new ProcessManager();
  addScript("wait-for-file.sh");

  const startedAt = Date.now();
  const info = await manager.start(
    "long-running",
    "./wait-for-file.sh never",
    cwd,
  );
  const elapsed = Date.now() - startedAt;

  expect(info.status).toBe("running");
  expect(info.endTime).toBeNull();
  expect(elapsed).toBeLessThan(5000);
});
