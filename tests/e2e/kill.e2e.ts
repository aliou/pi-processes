import { existsSync } from "node:fs";

import { assert, expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";
import { collectEvents } from "./utils";

test("kills a real running process and clears finished logs", async ({
  cwd,
  addScript,
}) => {
  using manager = getManager();
  const events = collectEvents(manager);
  addScript("wait-for-file.sh");

  const info = manager.start("kill-target", "./wait-for-file.sh never", cwd, {
    alertOnKill: true,
  });
  const files = manager.getLogFiles(info.id);
  assert(files, "log files should exist");

  const result = await manager.kill(info.id, {
    signal: "SIGKILL",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.info.status).toBe("killed");
    expect(result.info.alertOnKill).toBe(false);
  }

  expect(events.some((event) => event.type === "process_ended")).toBe(true);
  expect(manager.clearFinished()).toBe(1);
  expect(manager.get(info.id)).toBeNull();
  expect(existsSync(files.stdoutFile)).toBe(false);
  expect(existsSync(files.stderrFile)).toBe(false);
  expect(existsSync(files.combinedFile)).toBe(false);
});
