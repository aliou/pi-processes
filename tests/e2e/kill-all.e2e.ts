import { expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { LIVE_STATUSES } from "../../src/types";
import { test } from "./fixtures";
import { waitForEndedCount } from "./utils";

test("killAll stops real live processes", async ({ cwd, addScript }) => {
  using manager = getManager();
  addScript("wait-for-file.sh");

  const first = manager.start("first-live", "./wait-for-file.sh never", cwd);
  const second = manager.start("second-live", "./wait-for-file.sh never", cwd);
  const allEnded = waitForEndedCount(manager, new Set([first.id, second.id]));

  manager.killAll();
  await allEnded;

  for (const processInfo of manager.list()) {
    expect(LIVE_STATUSES.has(processInfo.status)).toBe(false);
  }
});
