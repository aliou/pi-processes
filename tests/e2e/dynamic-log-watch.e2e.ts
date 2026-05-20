import { expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";
import { collectEvents, waitForEnd, waitForWatchMatch } from "./utils";

test("adds log watches to a real process while it is running", async ({
  cwd,
  addFile,
  addScript,
}) => {
  using manager = getManager();
  const events = collectEvents(manager);
  addScript("wait-for-file.sh");

  const info = manager.start(
    "dynamic-watch",
    './wait-for-file.sh release-output "dynamic ready"',
    cwd,
  );

  expect(
    manager.addLogWatches(info.id, [
      { pattern: "dynamic ready", stream: "stdout" },
    ]),
  ).toEqual({
    ok: true,
    added: 1,
  });

  addFile("release-output");

  const match = await waitForWatchMatch(
    manager,
    events,
    info.id,
    (candidate) => candidate.line === "dynamic ready",
  );
  const ended = await waitForEnd(manager, info.id);

  expect(match.watch).toEqual(
    expect.objectContaining({
      pattern: "dynamic ready",
      index: 0,
    }),
  );
  expect(ended.success).toBe(true);
});
