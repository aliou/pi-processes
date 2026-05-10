import { existsSync } from "node:fs";

import { assert, expect } from "vitest";
import { getManager } from "../../src/get-manager";
import type { ManagerEvent } from "../../src/types";
import { test } from "./fixtures";
import { collectEvents, waitForEnd } from "./utils";

test("runs a real process and records logs, events, output, and watches", async ({
  cwd,
  addScript,
}) => {
  using manager = getManager();
  const events = collectEvents(manager);
  addScript("emit-output.sh");

  const info = manager.start("real-output", "./emit-output.sh", cwd, {
    alertOnSuccess: true,
    alertOnFailure: false,
    alertOnKill: true,
    logWatches: [
      { pattern: "server ready on http://localhost:3000" },
      { pattern: "TypeError|ReferenceError", mode: "regex", stream: "stderr" },
      { pattern: "job completed", stream: "stdout", repeat: true },
    ],
  });

  const ended = await waitForEnd(manager, info.id);

  expect(ended).toEqual(
    expect.objectContaining({
      id: info.id,
      status: "exited",
      exitCode: 0,
      success: true,
      alertOnSuccess: true,
      alertOnFailure: false,
      alertOnKill: true,
    }),
  );

  expect(manager.list().map((processInfo) => processInfo.id)).toEqual([
    info.id,
  ]);

  const output = manager.getOutput(info.id, 2);
  assert(output, "output should exist");
  expect(output).toEqual(
    expect.objectContaining({
      stdout: ["unrelated healthcheck ok", "tail"],
      stderr: ["TypeError: broken fixture"],
      status: "exited",
    }),
  );

  const fullOutput = manager.getFullOutput(info.id);
  assert(fullOutput, "full output should exist");
  expect(fullOutput.stdout).toBe(
    "booting fixture service\nserver ready on http://localhost:3000\ncache warmup complete\njob completed\nunrelated healthcheck ok\ntail",
  );
  expect(fullOutput.stderr).toBe("TypeError: broken fixture\n");

  const combined = manager.getCombinedOutput(info.id, 10);
  assert(combined, "combined output should exist");
  expect(combined).toEqual(
    expect.arrayContaining([
      { type: "stdout", text: "server ready on http://localhost:3000" },
      { type: "stdout", text: "job completed" },
      { type: "stdout", text: "tail" },
      { type: "stderr", text: "TypeError: broken fixture" },
    ]),
  );

  const files = manager.getLogFiles(info.id);
  assert(files, "log files should exist");
  expect(existsSync(files.stdoutFile)).toBe(true);
  expect(existsSync(files.stderrFile)).toBe(true);
  expect(existsSync(files.combinedFile)).toBe(true);

  const sizes = manager.getFileSize(info.id);
  assert(sizes, "file sizes should exist");
  expect(sizes.stdout).toBeGreaterThan(0);
  expect(sizes.stderr).toBeGreaterThan(0);

  const outputEvents = events.filter(
    (
      event,
    ): event is Extract<ManagerEvent, { type: "process_output_changed" }> =>
      event.type === "process_output_changed",
  );
  expect(outputEvents.length).toBeGreaterThan(0);
  expect(outputEvents.flatMap((event) => event.appendedText ?? [])).toEqual(
    expect.arrayContaining([
      { type: "stdout", text: "server ready on http://localhost:3000" },
      { type: "stdout", text: "job completed" },
      { type: "stdout", text: "tail" },
      { type: "stderr", text: "TypeError: broken fixture" },
    ]),
  );

  const watchMatches = events.filter(
    (
      event,
    ): event is Extract<ManagerEvent, { type: "process_watch_matched" }> =>
      event.type === "process_watch_matched",
  );
  expect(watchMatches).toHaveLength(3);
  expect(watchMatches.map((event) => event.match.watch.pattern)).toEqual(
    expect.arrayContaining([
      "server ready on http://localhost:3000",
      "TypeError|ReferenceError",
      "job completed",
    ]),
  );
  expect(
    watchMatches.find(
      (event) =>
        event.match.watch.pattern === "server ready on http://localhost:3000",
    )?.match.watch.mode,
  ).toBe("literal");

  expect(events.some((event) => event.type === "process_started")).toBe(true);
  expect(events.some((event) => event.type === "process_ended")).toBe(true);
});
