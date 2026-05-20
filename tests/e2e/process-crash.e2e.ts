import { assert, expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";
import { collectEvents, waitForEnd, waitForWatchMatch } from "./utils";

test("records a real process that fails by itself", async ({
  cwd,
  addFile,
  addScript,
}) => {
  using manager = getManager();
  const events = collectEvents(manager);
  addScript("crash-on-file.sh");

  const info = manager.start(
    "self-failing-worker",
    "bash ./crash-on-file.sh crash-now",
    cwd,
    {
      logWatches: [{ pattern: "fatal: marker", stream: "stderr" }],
    },
  );

  addFile("crash-now");

  const match = await waitForWatchMatch(
    manager,
    events,
    info.id,
    (candidate) => candidate.line === "fatal: marker crash-now detected",
  );
  const ended = await waitForEnd(manager, info.id);

  expect(match.source).toBe("stderr");
  expect(ended).toEqual(
    expect.objectContaining({
      status: "exited",
      exitCode: 42,
      success: false,
    }),
  );

  const output = manager.getOutput(info.id, 10);
  assert(output, "output should exist");
  expect(output.stderr).toContain("fatal: marker crash-now detected");
});
