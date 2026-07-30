import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_STATUSES, type ManagerEvent } from "./constants";
import { ProcessManager } from "./manager";
import { killProcessGroup } from "./utils";

function waitForEnd(manager: ProcessManager, id: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = manager.onEvent((event) => {
      if (event.type === "process_ended" && event.info.id === id) {
        unsub();
        resolve();
      }
    });

    const process = manager.get(id);
    if (process && !LIVE_STATUSES.has(process.status)) {
      unsub();
      resolve();
    }
  });
}

function collectEvents(manager: ProcessManager): ManagerEvent[] {
  const events: ManagerEvent[] = [];
  // Unsubscribe not stored; manager.cleanup() in afterEach clears all listeners.
  manager.onEvent((e) => events.push(e));
  return events;
}

function childThatFailsOnNextTick(error: Error): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdin: null,
    stdout: null,
    stderr: null,
    unref: () => child,
  });
  process.nextTick(() => child.emit("error", error));
  return child as unknown as ChildProcess;
}

describe("process initialization", () => {
  let manager: ProcessManager;

  afterEach(() => {
    manager.cleanup();
  });

  it("records an asynchronous spawn error and emits one terminal event", async () => {
    const spawnError = Object.assign(new Error("spawn /bin/bash ENOENT"), {
      code: "ENOENT",
    });
    manager = new ProcessManager({
      spawnCommand: () => childThatFailsOnNextTick(spawnError),
    });
    const events = collectEvents(manager);

    const info = await manager.start("missing-cwd", "true", "/missing");

    expect(info).toMatchObject({
      pid: 0,
      status: "exited",
      exitCode: -1,
      success: false,
      error: "spawn /bin/bash ENOENT",
    });
    expect(manager.get(info.id)?.error).toBe("spawn /bin/bash ENOENT");
    expect(manager.getFullOutput(info.id)?.stderr).toContain(
      "Process error: spawn /bin/bash ENOENT",
    );
    expect(events.filter((event) => event.type === "process_started")).toEqual(
      [],
    );
    expect(
      events.filter((event) => event.type === "process_ended"),
    ).toHaveLength(1);
  });

  it("never signals an invalid process group during initialization", async () => {
    manager = new ProcessManager({
      spawnCommand: () =>
        childThatFailsOnNextTick(new Error("spawn initialization failed")),
    });
    const processKill = vi.spyOn(process, "kill");

    const start = manager.start("missing-cwd", "true", "/missing");
    manager.shutdownKillAll();
    manager.cleanup();
    const info = await start;

    expect(processKill).not.toHaveBeenCalled();
    expect(info.pid).toBe(0);
    expect(() => killProcessGroup(0, "SIGKILL")).toThrow(RangeError);
    expect(() => killProcessGroup(-1, "SIGKILL")).toThrow(RangeError);
    expect(processKill).not.toHaveBeenCalled();
    processKill.mockRestore();
  });

  it("returns retained failure details if an end listener clears the record", async () => {
    manager = new ProcessManager({
      spawnCommand: () =>
        childThatFailsOnNextTick(new Error("spawn initialization failed")),
    });
    manager.onEvent((event) => {
      if (event.type === "process_ended") manager.clearFinished();
    });

    const info = await manager.start("racy-start", "true", "/missing");

    expect(manager.get(info.id)).toBeNull();
    expect(info.error).toBe("spawn initialization failed");
    expect(info.success).toBe(false);
  });

  it("reports a real missing cwd while an existing cwd starts successfully", async () => {
    manager = new ProcessManager();
    const parent = mkdtempSync(join(tmpdir(), "pi-processes-cwd-"));

    try {
      const failed = await manager.start(
        "missing-cwd",
        "true",
        join(parent, "missing"),
      );
      expect(failed.success).toBe(false);
      expect(failed.error).toContain("ENOENT");

      const started = await manager.start("existing-cwd", "sleep 0.1", parent);
      expect(started.pid).toBeGreaterThan(0);
      expect(started.status).toBe("running");
      expect(started.error).toBeNull();
    } finally {
      manager.cleanup();
      rmSync(parent, { recursive: true, force: true });
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
    const info = await manager.start("test", "echo hello", "/tmp");
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
    const info = await manager.start("test", "echo err >&2", "/tmp");
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
    const info = await manager.start("test", "seq 1 200", "/tmp");
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
    const info2 = await manager.start(
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
    const info = await manager.start("test", "seq 1 100", "/tmp");
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
    const info = await manager.start("test", "echo hello", "/tmp");
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
    const info = await manager.start("test", "true", "/tmp");
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
    const info = await manager.start("test", "seq 1 50", "/tmp");
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

    const info1 = await manager.start("proc1", "echo one", "/tmp");
    const info2 = await manager.start("proc2", "echo two", "/tmp");

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

    const info = await manager.start(
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

    const info = await manager.start(
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

    const info = await manager.start(
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

    const info = await manager.start(
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

    const info = await manager.start("watch-trailing", "printf ready", "/tmp", {
      logWatches: [{ pattern: "ready" }],
    });

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);
  });

  it("throws for invalid watch regex", async () => {
    manager = new ProcessManager();

    await expect(
      manager.start("bad-watch", "echo ok", "/tmp", {
        logWatches: [{ pattern: "(" }],
      }),
    ).rejects.toThrowError(/Invalid log watch pattern/);
  });
});
