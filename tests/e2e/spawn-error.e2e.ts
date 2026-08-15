import { join } from "node:path";

import { expect } from "vitest";
import { ProcessManager } from "../../src/manager";
import { test } from "./fixtures";
import { collectEvents } from "./utils";

test("captures async spawn error for a non-existent cwd without crashing", async ({
  cwd,
}) => {
  using manager = new ProcessManager();
  const events = collectEvents(manager);

  // The cwd does not exist, so the spawn fails during initialization:
  // child.pid is undefined and an async ENOENT `error` event fires on the
  // next tick. Without an error listener attached before start() returns,
  // this crashes the process via uncaughtException (which would fail the
  // whole test run).
  const missingCwd = join(cwd, "does-not-exist");
  const info = manager.start("missing-cwd", "true", missingCwd);

  // The record is transitioned to exited synchronously; give the async
  // spawn error a turn to arrive and enrich the record with the real reason.
  await new Promise((r) => setImmediate(r));

  const ended = manager.get(info.id);
  expect(ended).toEqual(
    expect.objectContaining({
      status: "exited",
      success: false,
      exitCode: -1,
      endReason: "spawn_error",
    }),
  );
  expect(ended?.errorMessage).toMatch(/ENOENT/);

  const endedEvents = events.filter((e) => e.type === "process_ended");
  expect(endedEvents).toHaveLength(1);
});
