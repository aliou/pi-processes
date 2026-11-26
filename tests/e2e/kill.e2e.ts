import { existsSync } from "node:fs";

import { assert, expect, vi } from "vitest";
import { ProcessManager } from "../../src/manager";
import { test } from "./fixtures";
import { collectEvents } from "./utils";

test("reports one clean exit when a process handles SIGTERM", async ({
  cwd,
  addFile,
}) => {
  using manager = new ProcessManager();
  const events = collectEvents(manager);
  addFile(
    "clean-stop.sh",
    '#!/bin/sh\ntrap "exit 0" TERM\necho ready\nwhile true; do sleep 0.1; done\n',
  );
  const info = await manager.start("clean-stop", "sh ./clean-stop.sh", cwd);
  await vi.waitFor(() => {
    expect(manager.getOutput(info.id)?.stdout).toContain("ready");
  });

  const startedAt = Date.now();
  const result = await manager.kill(info.id);
  const elapsed = Date.now() - startedAt;

  expect(result).toEqual({
    ok: true,
    info: expect.objectContaining({
      status: "exited",
      success: true,
      exitCode: 0,
      endReason: "exit",
    }),
  });
  expect(
    events.filter(
      (event) => event.type === "process_ended" && event.info.id === info.id,
    ),
  ).toHaveLength(1);
  expect(elapsed).toBeLessThan(2000);
});

test("kills a real running process and clears finished logs", async ({
  cwd,
  addScript,
}) => {
  using manager = new ProcessManager();
  const events = collectEvents(manager);
  addScript("wait-for-file.sh");

  const info = await manager.start(
    "kill-target",
    "./wait-for-file.sh never",
    cwd,
  );
  const files = manager.getLogFiles(info.id);
  assert(files, "log files should exist");

  const result = await manager.kill(info.id, {
    signal: "SIGKILL",
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.info.status).toBe("killed");
  }

  expect(events.some((event) => event.type === "process_ended")).toBe(true);
  expect(manager.clearFinished()).toBe(1);
  expect(manager.get(info.id)).toBeNull();
  expect(existsSync(files.stdoutFile)).toBe(false);
  expect(existsSync(files.stderrFile)).toBe(false);
  expect(existsSync(files.combinedFile)).toBe(false);
});
