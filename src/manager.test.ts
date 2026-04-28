import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ManagerEvent } from "./constants";
import { ProcessManager } from "./manager";

function waitForEnd(manager: ProcessManager, id: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = manager.onEvent((e) => {
      if (e.type === "process_ended" && e.info.id === id) {
        unsub();
        resolve();
      }
    });
  });
}

function collectEvents(manager: ProcessManager): ManagerEvent[] {
  const events: ManagerEvent[] = [];
  // Unsubscribe not stored; manager.cleanup() in afterEach clears all listeners.
  manager.onEvent((e) => events.push(e));
  return events;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForWatchMatch(manager: ProcessManager, id: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = manager.onEvent((e) => {
      if (e.type === "process_watch_matched" && e.match.processId === id) {
        unsub();
        resolve();
      }
    });
  });
}

describe("process log directories", () => {
  it("uses a unique log directory for each manager", () => {
    const first = new ProcessManager();
    const second = new ProcessManager();

    try {
      const firstInfo = first.start("first", "cat", "/tmp");
      const secondInfo = second.start("second", "cat", "/tmp");

      expect(dirname(firstInfo.stdoutFile)).not.toBe(
        dirname(secondInfo.stdoutFile),
      );
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });
});

describe("process_output_changed", () => {
  let manager: ProcessManager;

  afterEach(() => {
    manager.cleanup();
  });

  it("emits process_output_changed on stdout", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo hello", "/tmp");
    await waitForEnd(manager, info.id);

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
    expect(outputEvents[0]).toEqual({
      type: "process_output_changed",
      id: info.id,
    });
  });

  it("emits process_output_changed on stderr", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo err >&2", "/tmp");
    await waitForEnd(manager, info.id);

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
    expect(outputEvents[0]).toEqual({
      type: "process_output_changed",
      id: info.id,
    });
  });

  it("throttles rapid output", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "seq 1 200", "/tmp");
    await waitForEnd(manager, info.id);

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    // Should be significantly fewer than 200 due to throttling
    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
    expect(outputEvents.length).toBeLessThan(50);
  });

  it("stdout and stderr share one throttle bucket", async () => {
    manager = new ProcessManager();

    // Dual-stream burst: writes to both stdout and stderr rapidly
    const events2 = collectEvents(manager);
    const info2 = manager.start(
      "dual",
      "bash -c 'for i in $(seq 1 50); do echo out$i; echo err$i >&2; done'",
      "/tmp",
    );
    await waitForEnd(manager, info2.id);
    const dualCount = events2.filter(
      (e) => e.type === "process_output_changed",
    ).length;

    // Both streams share one throttle bucket, so total events should be low
    expect(dualCount).toBeLessThan(30);
  });

  it("trailing emit fires after burst ends", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "seq 1 100", "/tmp");
    await waitForEnd(manager, info.id);

    // There should be at least one output event, and a process_ended event
    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    const endEvents = events.filter((e) => e.type === "process_ended");
    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
    expect(endEvents.length).toBe(1);
  });

  it("final output event before process_ended", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo hello", "/tmp");
    await waitForEnd(manager, info.id);

    let lastOutputIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "process_output_changed") {
        lastOutputIdx = i;
        break;
      }
    }
    const endIdx = events.findIndex((e) => e.type === "process_ended");

    expect(lastOutputIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThanOrEqual(0);
    expect(lastOutputIdx).toBeLessThan(endIdx);
  });

  it("no output events for silent process", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "true", "/tmp");
    await waitForEnd(manager, info.id);

    // Wait a bit for any stale trailing emits
    await new Promise((r) => setTimeout(r, 200));

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(outputEvents.length).toBe(0);
  });

  it("no stale events after clearFinished", async () => {
    manager = new ProcessManager();
    const info = manager.start("test", "seq 1 50", "/tmp");
    await waitForEnd(manager, info.id);

    manager.clearFinished();

    const lateEvents: ManagerEvent[] = [];
    manager.onEvent((e) => lateEvents.push(e));

    await new Promise((r) => setTimeout(r, 200));

    const staleOutput = lateEvents.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(staleOutput.length).toBe(0);
  });

  it("events carry correct process id with multiple processes", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);

    const info1 = manager.start("proc1", "echo one", "/tmp");
    const info2 = manager.start("proc2", "echo two", "/tmp");

    await Promise.all([
      waitForEnd(manager, info1.id),
      waitForEnd(manager, info2.id),
    ]);

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );

    for (const e of outputEvents) {
      if (e.type === "process_output_changed") {
        expect([info1.id, info2.id]).toContain(e.id);
      }
    }

    // Both processes should have at least one output event
    const ids = new Set(
      outputEvents
        .filter(
          (e): e is Extract<ManagerEvent, { type: "process_output_changed" }> =>
            e.type === "process_output_changed",
        )
        .map((e) => e.id),
    );
    expect(ids.has(info1.id)).toBe(true);
    expect(ids.has(info2.id)).toBe(true);
  });
});

describe("process_watch_matched", () => {
  let manager: ProcessManager;

  afterEach(() => {
    manager.cleanup();
  });

  it("fires once by default on first matching line", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start(
      "watch-once",
      "bash -c 'echo ready; echo ready; echo ready'",
      "/tmp",
      {
        logWatches: [{ pattern: "ready" }],
      },
    );

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);

    const first = matches[0];
    if (first.type === "process_watch_matched") {
      expect(first.match.processId).toBe(info.id);
      expect(first.match.source).toBe("stdout");
      expect(first.match.watch.repeat).toBe(false);
      expect(first.match.line).toBe("ready");
    }
  });

  it("supports repeat watches", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start(
      "watch-repeat",
      "bash -c 'echo done; echo done; echo done'",
      "/tmp",
      {
        logWatches: [{ pattern: "done", repeat: true }],
      },
    );

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(3);
  });

  it("respects stream scoping", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start(
      "watch-stream",
      "bash -c 'echo out; echo err >&2'",
      "/tmp",
      {
        logWatches: [{ pattern: "err", stream: "stderr" }],
      },
    );

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);

    const match = matches[0];
    if (match.type === "process_watch_matched") {
      expect(match.match.source).toBe("stderr");
      expect(match.match.line).toBe("err");
    }
  });

  it("stream both matches stdout and stderr", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start(
      "watch-both",
      "bash -c 'echo marker; echo marker >&2'",
      "/tmp",
      {
        logWatches: [{ pattern: "marker", stream: "both", repeat: true }],
      },
    );

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(2);

    const sources = new Set(
      matches
        .filter(
          (e): e is Extract<ManagerEvent, { type: "process_watch_matched" }> =>
            e.type === "process_watch_matched",
        )
        .map((e) => e.match.source),
    );

    expect(sources.has("stdout")).toBe(true);
    expect(sources.has("stderr")).toBe(true);
  });

  it("matches trailing partial line at process end", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start("watch-trailing", "printf ready", "/tmp", {
      logWatches: [{ pattern: "ready" }],
    });

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);
  });

  it("does not report active watches for exited processes", async () => {
    manager = new ProcessManager();

    const info = manager.start("watch-exit", "echo ready", "/tmp", {
      logWatches: [{ pattern: "ready", repeat: true }],
    });

    await waitForEnd(manager, info.id);

    expect(manager.get(info.id)).toMatchObject({
      watchCount: 1,
      activeWatchCount: 0,
    });
  });

  it("throws for invalid watch regex", () => {
    manager = new ProcessManager();

    expect(() =>
      manager.start("bad-watch", "echo ok", "/tmp", {
        logWatches: [{ pattern: "(" }],
      }),
    ).toThrowError(/Invalid log watch pattern/);
  });

  it("appends watches to a running process", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("watch-update", "cat", "/tmp");

    const update = manager.update(info.id, {
      logWatchUpdate: {
        mode: "append",
        watches: [{ pattern: "ready" }],
      },
    });

    expect(update.ok).toBe(true);
    if (update.ok) {
      expect(update.watches).toMatchObject([
        { index: 0, pattern: "ready", stream: "both", repeat: false },
      ]);
    }
    expect(manager.get(info.id)).toMatchObject({
      watchCount: 1,
      activeWatchCount: 1,
    });

    const matched = waitForWatchMatch(manager, info.id);
    manager.writeToStdin(info.id, "ready\n");
    await matched;

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);
    expect(manager.get(info.id)).toMatchObject({
      watchCount: 1,
      activeWatchCount: 0,
    });
    const match = matches[0];
    if (match.type === "process_watch_matched") {
      expect(match.match.watch.index).toBe(0);
      expect(match.match.line).toBe("ready");
    }
  });

  it("replaces noisy watches without reusing indexes", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("watch-replace", "cat", "/tmp", {
      logWatches: [{ pattern: "noise", repeat: true }],
    });

    const update = manager.update(info.id, {
      logWatchUpdate: {
        mode: "replace",
        watches: [{ pattern: "ready" }],
      },
    });

    expect(update.ok).toBe(true);
    if (update.ok) {
      expect(update.watches).toMatchObject([
        { index: 1, pattern: "ready", stream: "both", repeat: false },
      ]);
    }

    const matched = waitForWatchMatch(manager, info.id);
    manager.writeToStdin(info.id, "noise\nready\n");
    await matched;
    await sleep(100);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);
    const match = matches[0];
    if (match.type === "process_watch_matched") {
      expect(match.match.watch.index).toBe(1);
      expect(match.match.line).toBe("ready");
    }
  });

  it("removes and clears watches by stable index", () => {
    manager = new ProcessManager();
    const info = manager.start("watch-remove", "cat", "/tmp", {
      logWatches: [{ pattern: "one" }, { pattern: "two" }],
    });

    const remove = manager.update(info.id, {
      logWatchUpdate: { mode: "remove", watchIndexes: [0] },
    });
    expect(remove.ok).toBe(true);
    if (remove.ok) {
      expect(remove.watches).toMatchObject([{ index: 1, pattern: "two" }]);
    }

    const clear = manager.update(info.id, {
      logWatchUpdate: { mode: "clear" },
    });
    expect(clear.ok).toBe(true);
    if (clear.ok) expect(clear.watches).toHaveLength(0);
  });

  it("does not mutate existing watches when an update has invalid regex", () => {
    manager = new ProcessManager();
    const info = manager.start("watch-invalid", "cat", "/tmp", {
      logWatches: [{ pattern: "ready" }],
    });

    const update = manager.update(info.id, {
      logWatchUpdate: {
        mode: "append",
        watches: [{ pattern: "(" }],
      },
    });

    expect(update.ok).toBe(false);
    if (!update.ok) {
      expect(update.reason).toBe("invalid");
      expect(update.watches).toMatchObject([{ index: 0, pattern: "ready" }]);
    }

    const list = manager.update(info.id, { logWatchUpdate: { mode: "list" } });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.watches).toMatchObject([{ index: 0, pattern: "ready" }]);
    }
  });

  it("replays recent output for newly added one-time watches", async () => {
    manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("watch-replay", "cat", "/tmp");

    manager.writeToStdin(info.id, "done\n");
    await sleep(100);

    const update = manager.update(info.id, {
      logWatchUpdate: {
        mode: "append",
        watches: [{ pattern: "done" }],
        replayTailLines: 10,
      },
    });

    expect(update.ok).toBe(true);
    if (update.ok) {
      expect(update.replayMatches).toMatchObject([
        { watchIndex: 0, source: "stdout", line: "done" },
      ]);
      expect(update.watches).toMatchObject([{ index: 0, fired: true }]);
    }

    manager.writeToStdin(info.id, "done\n");
    await sleep(100);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(0);
  });

  it("rejects replay limits above the bounded caps without mutating watches", () => {
    manager = new ProcessManager();
    const info = manager.start("watch-replay-cap", "cat", "/tmp", {
      logWatches: [{ pattern: "ready" }],
    });

    const update = manager.update(info.id, {
      logWatchUpdate: {
        mode: "append",
        watches: [{ pattern: "done" }],
        replayTailLines: 10001,
      },
    });

    expect(update.ok).toBe(false);
    if (!update.ok) {
      expect(update.message).toBe("replayTailLines must be <= 10000");
      expect(update.watches).toMatchObject([{ index: 0, pattern: "ready" }]);
    }
  });

  it("updates process metadata alert flags and name", () => {
    manager = new ProcessManager();
    const info = manager.start("old-name", "cat", "/tmp");

    const update = manager.update(info.id, {
      name: "new-name",
      alertOnSuccess: true,
      alertOnFailure: false,
      alertOnKill: true,
    });

    expect(update.ok).toBe(true);
    if (update.ok) {
      expect(update.info.name).toBe("new-name");
      expect(update.info.alertOnSuccess).toBe(true);
      expect(update.info.alertOnFailure).toBe(false);
      expect(update.info.alertOnKill).toBe(true);
    }
  });

  it("exposes combined log file paths in process info and log details", () => {
    manager = new ProcessManager();
    const info = manager.start("combined", "cat", "/tmp");

    expect(info.combinedFile).toMatch(/proc_\d+-combined\.log$/);
    expect(manager.get(info.id)?.combinedFile).toBe(info.combinedFile);
    expect(manager.getLogFiles(info.id)?.combinedFile).toBe(info.combinedFile);
  });
});
