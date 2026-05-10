import { existsSync } from "node:fs";

import { assert, expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";
import { waitForEnd } from "./utils";

test("cleanup stops a real live process and removes logs", async ({
  cwd,
  addScript,
}) => {
  using manager = getManager();
  addScript("wait-for-file.sh");

  const cleanupTarget = manager.start(
    "cleanup-live",
    "./wait-for-file.sh never",
    cwd,
  );
  const files = manager.getLogFiles(cleanupTarget.id);
  assert(files, "log files should exist");
  const cleanupEnded = waitForEnd(manager, cleanupTarget.id);

  manager.cleanup();
  await cleanupEnded;

  expect(existsSync(files.stdoutFile)).toBe(false);
  expect(existsSync(files.stderrFile)).toBe(false);
  expect(existsSync(files.combinedFile)).toBe(false);
});
