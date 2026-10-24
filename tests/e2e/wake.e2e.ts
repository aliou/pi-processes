import { expect } from "vitest";
import { ProcessManager } from "../../src/manager";
import type { ManagerEvent } from "../../src/types";
import { test } from "./fixtures";
import { collectEvents, waitForEnd } from "./utils";

test("evaluates wake watches and reports wake conditions for live processes", async ({
  cwd,
  addScript,
  addFile,
}) => {
  using manager = new ProcessManager();
  const events = collectEvents(manager);
  addScript("wait-for-file.sh");

  const info = manager.start("wake-watched", "./wait-for-file.sh", cwd);
  manager.registerWakeConfig(info.id, {
    onSuccess: "context",
    logMatches: [{ pattern: "waiting for" }, { pattern: "never-matches" }],
  });

  const matched = await waitForWatchMatches(events);

  const conditions = manager.getWakeConditions(info.id);
  expect(conditions).toEqual({
    exitAttention: { success: "context", failure: "turn", killed: "context" },
    watches: [
      expect.objectContaining({ pattern: "waiting for", fired: true }),
      expect.objectContaining({ pattern: "never-matches", fired: false }),
    ],
  });

  const match = matched.matches[0];
  expect(match).toMatchObject({
    pattern: "waiting for",
    mode: "literal",
    stream: "stdout",
    line: "waiting for release-output",
    on: "turn",
  });

  addFile("release-output");
  await waitForEnd(manager, info.id);

  await flushMicrotasks();
  expect(manager.getWakeConditions(info.id)).toBeNull();
  expect(manager.getWakeConfig(info.id)).toBeNull();
  expect(manager.getWatchState(info.id)).toBeNull();
});

test("listWithWake attaches wake to live processes only", async ({
  cwd,
  addScript,
}) => {
  using manager = new ProcessManager();
  addScript("continuous-output.sh");
  addScript("emit-output.sh");

  const live = manager.start("live", "./continuous-output.sh", cwd);
  manager.registerWakeConfig(live.id, {
    logMatches: [{ pattern: "ping" }],
  });
  const ended = manager.start("ended", "./emit-output.sh", cwd);
  await waitForEnd(manager, ended.id);

  const entries = manager.listWithWake();
  const liveEntry = entries.find((entry) => entry.id === live.id);
  const endedEntry = entries.find((entry) => entry.id === ended.id);

  expect(liveEntry?.wake?.watches).toEqual([
    expect.objectContaining({ pattern: "ping" }),
  ]);
  expect(liveEntry?.wake?.exitAttention).toEqual({
    success: "turn",
    failure: "turn",
    killed: "context",
  });
  expect("wake" in (endedEntry ?? {})).toBe(false);

  await manager.kill(live.id);
  await waitForEnd(manager, live.id);
});

test("ends expose the wake config to listeners before it is cleared", async ({
  cwd,
  addScript,
}) => {
  using manager = new ProcessManager();
  addScript("emit-output.sh");

  const seenInMicrotask: Array<string | null> = [];
  const unsubscribe = manager.onEvent((event) => {
    if (event.type !== "process_ended") return;
    const id = event.info.id;
    queueMicrotask(() => {
      seenInMicrotask.push(manager.getWakeConfig(id)?.onSuccess ?? null);
    });
  });

  const info = manager.start("config-race", "./emit-output.sh", cwd);
  manager.registerWakeConfig(info.id, { onSuccess: "context" });

  await waitForEnd(manager, info.id);
  await flushMicrotasks();

  expect(seenInMicrotask).toEqual(["context"]);
  expect(manager.getWakeConfig(info.id)).toBeNull();
  unsubscribe();
});

function waitForWatchMatches(
  events: ManagerEvent[],
): Promise<Extract<ManagerEvent, { type: "process_watch_matched" }>> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const match = events.find(
        (
          event,
        ): event is Extract<ManagerEvent, { type: "process_watch_matched" }> =>
          event.type === "process_watch_matched",
      );
      if (match) {
        resolve(match);
        return;
      }
      if (Date.now() - started > 5000) {
        reject(new Error("Timed out waiting for watch matches"));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
