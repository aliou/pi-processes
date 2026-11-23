import { existsSync } from "node:fs";

import { assert, expect, vi } from "vitest";
import { ProcessManager } from "../../src/manager";
import { test } from "./fixtures";
import { collectEvents } from "./utils";

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

test("reports a single clean exit when a process handles SIGTERM (#173)", async ({
  cwd,
  addFile,
}) => {
  using manager = new ProcessManager();
  addFile(
    "stop-cleanly.cjs",
    `process.on("SIGTERM", () => process.exit(0));
console.log("ready");
setInterval(() => {}, 1000);
`,
  );
  const events = collectEvents(manager);
  const info = await manager.start(
    "clean-exit",
    "exec node stop-cleanly.cjs",
    cwd,
  );
  await vi.waitFor(() => {
    expect(manager.getOutput(info.id)?.stdout).toContain("ready");
  });

  const result = await manager.kill(info.id, { timeoutMs: 2000 });

  expect(result).toMatchObject({
    ok: true,
    info: { status: "exited", endReason: "exit", exitCode: 0, success: true },
  });
  expect(events.filter((event) => event.type === "process_ended")).toEqual([
    { type: "process_ended", info: manager.get(info.id) },
  ]);
});
