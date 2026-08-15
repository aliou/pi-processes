import { assert, expect } from "vitest";
import { ProcessManager } from "../../src/manager";
import { test } from "./fixtures";
import { waitForEnd } from "./utils";

test("records a real process that fails by itself", async ({
  cwd,
  addFile,
  addScript,
}) => {
  using manager = new ProcessManager();
  addScript("crash-on-file.sh");

  const info = manager.start(
    "self-failing-worker",
    "bash ./crash-on-file.sh crash-now",
    cwd,
  );

  addFile("crash-now");

  const ended = await waitForEnd(manager, info.id);

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
