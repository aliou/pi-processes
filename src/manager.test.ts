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
