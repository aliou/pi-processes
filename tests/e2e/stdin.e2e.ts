import { assert, expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";
import { waitForEnd } from "./utils";

test("writes to stdin of a real process and then rejects writes after exit", async ({
  cwd,
}) => {
  using manager = getManager();

  const info = manager.start(
    "stdin",
    "IFS= read -r line; printf 'stdin:%s\\n' \"$line\"; printf 'done\\n' >&2",
    cwd,
  );

  expect(
    manager.writeToStdin(info.id, "hello from e2e\n", { end: true }),
  ).toEqual({
    ok: true,
  });

  await waitForEnd(manager, info.id);

  const output = manager.getOutput(info.id, 10);
  assert(output, "output should exist");
  expect(output.stdout).toEqual(["stdin:hello from e2e"]);
  expect(output.stderr).toEqual(["done"]);
  expect(manager.writeToStdin(info.id, "late\n")).toEqual({
    ok: false,
    reason: "process_exited",
  });
});
