import { assert, expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";
import { waitForEnd } from "./utils";

test("drives an interactive stdin repl across multiple lines and quits", async ({
  cwd,
  addScript,
}) => {
  addScript("stdin-echo.sh");

  using manager = getManager();

  const info = manager.start("stdin-repl", "./stdin-echo.sh", cwd);

  expect(
    manager.writeToStdin(info.id, "first line\nsecond line\nquit\n"),
  ).toEqual({ ok: true });

  const ended = await waitForEnd(manager, info.id);
  expect(ended.status).toBe("exited");

  const output = manager.getOutput(info.id, 20);
  assert(output, "output should exist");
  expect(output.stdout).toEqual([
    "stdin repl ready",
    "echo:first line",
    "echo:second line",
    "goodbye",
  ]);
});

test("closing stdin with end:true drives the EOF path to a clean exit", async ({
  cwd,
  addScript,
}) => {
  addScript("stdin-echo.sh");

  using manager = getManager();

  const info = manager.start("stdin-repl", "./stdin-echo.sh", cwd);

  expect(manager.writeToStdin(info.id, "only line\n")).toEqual({ ok: true });
  expect(manager.writeToStdin(info.id, "", { end: true })).toEqual({
    ok: true,
  });

  const ended = await waitForEnd(manager, info.id);
  expect(ended.status).toBe("exited");

  const output = manager.getOutput(info.id, 20);
  assert(output, "output should exist");
  expect(output.stdout).toEqual([
    "stdin repl ready",
    "echo:only line",
    "stdin closed",
  ]);
});
