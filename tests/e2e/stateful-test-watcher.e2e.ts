import { expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";
import { collectEvents } from "./utils";

test("tracks a stateful test watcher as files fix failures", async ({
  cwd,
  addFile,
  addScript,
}) => {
  using manager = getManager();
  const events = collectEvents(manager);
  addScript("stateful-test-watcher.mjs");

  const info = manager.start(
    "stateful-tests",
    "node ./stateful-test-watcher.mjs",
    cwd,
    {
      logWatches: [
        { pattern: "FAIL ", stream: "stdout", repeat: true },
        { pattern: "PASS ", stream: "stdout", repeat: true },
      ],
    },
  );

  await expect(manager).toHaveLine(
    events,
    info.id,
    "FAIL missing table: customers",
  );

  addFile("01-migrated");
  await expect(manager).toHaveLine(events, info.id, "PASS 01-migrated");
  await expect(manager).toHaveLine(
    events,
    info.id,
    "FAIL missing seed data: orders",
  );

  addFile("02-seeded");
  await expect(manager).toHaveLine(events, info.id, "PASS 02-seeded");
  await expect(manager).toHaveLine(
    events,
    info.id,
    "FAIL missing shipping calculator",
  );

  addFile("03-shipping");
  await expect(manager).toHaveLine(events, info.id, "PASS 03-shipping");
  await expect(manager).toHaveLine(events, info.id, "PASS all watched tests");

  const result = await manager.kill(info.id, { signal: "SIGKILL" });

  expect(result.ok).toBe(true);
});
