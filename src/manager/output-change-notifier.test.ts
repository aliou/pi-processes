import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerEvent } from "../types";
import { OutputChangeNotifier } from "./output-change-notifier";

describe("OutputChangeNotifier", () => {
  let emitted: ManagerEvent[];
  let appendedLines: Map<
    string,
    Array<{ type: "stdout" | "stderr"; text: string }>
  >;
  let existingProcesses: Set<string>;

  beforeEach(() => {
    emitted = [];
    appendedLines = new Map();
    existingProcesses = new Set();
  });

  function createNotifier(throttleMs = 100): OutputChangeNotifier {
    return new OutputChangeNotifier({
      emit: (event) => emitted.push(event),
      getAppendedLines: (id) => appendedLines.get(id),
      hasProcess: (id) => existingProcesses.has(id),
      throttleMs,
    });
  }

  it("emits immediately when not throttled", () => {
    using notifier = createNotifier();
    existingProcesses.add("p1");
    appendedLines.set("p1", [{ type: "stdout", text: "hello" }]);

    notifier.notify("p1");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      type: "process_output_changed",
      id: "p1",
      appendedText: [{ type: "stdout", text: "hello" }],
    });
  });

  it("does not include appendedText when no lines", () => {
    using notifier = createNotifier();
    existingProcesses.add("p1");
    // No appendedLines for p1

    notifier.notify("p1");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      type: "process_output_changed",
      id: "p1",
    });
  });

  it("throttles rapid notifications", () => {
    vi.useFakeTimers();
    using notifier = createNotifier(100);
    existingProcesses.add("p1");
    appendedLines.set("p1", [{ type: "stdout", text: "line1" }]);

    notifier.notify("p1");
    expect(emitted).toHaveLength(1);

    // Second call within throttle window -- should not emit immediately
    appendedLines.set("p1", [{ type: "stdout", text: "line2" }]);
    notifier.notify("p1");
    expect(emitted).toHaveLength(1); // still 1, throttled

    vi.useRealTimers();
  });

  it("emits pending after throttle window", () => {
    vi.useFakeTimers();
    using notifier = createNotifier(100);
    existingProcesses.add("p1");

    notifier.notify("p1");
    expect(emitted).toHaveLength(1);

    // Trigger a pending emit
    appendedLines.set("p1", [{ type: "stdout", text: "line2" }]);
    notifier.notify("p1");

    // Advance past throttle window
    vi.advanceTimersByTime(150);

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual({
      type: "process_output_changed",
      id: "p1",
      appendedText: [{ type: "stdout", text: "line2" }],
    });

    vi.useRealTimers();
  });

  it("flush sends pending event immediately", () => {
    vi.useFakeTimers();
    using notifier = createNotifier(100);
    existingProcesses.add("p1");

    notifier.notify("p1");
    expect(emitted).toHaveLength(1);

    // Second call is throttled, creates pending
    appendedLines.set("p1", [{ type: "stdout", text: "line2" }]);
    notifier.notify("p1");
    expect(emitted).toHaveLength(1);

    // Flush forces the pending emit
    notifier.flush("p1");
    expect(emitted).toHaveLength(2);

    vi.useRealTimers();
  });

  it("flush is no-op when nothing pending", () => {
    using notifier = createNotifier();
    existingProcesses.add("p1");

    notifier.flush("p1");
    expect(emitted).toHaveLength(0);
  });

  it("flush emits appended lines even without a pending timer", () => {
    using notifier = createNotifier();
    existingProcesses.add("p1");
    appendedLines.set("p1", [{ type: "stdout", text: "partial" }]);

    notifier.flush("p1");

    expect(emitted).toEqual([
      {
        type: "process_output_changed",
        id: "p1",
        appendedText: [{ type: "stdout", text: "partial" }],
      },
    ]);
  });

  it("clear removes pending timers and state", () => {
    vi.useFakeTimers();
    using notifier = createNotifier(100);
    existingProcesses.add("p1");

    notifier.notify("p1");
    appendedLines.set("p1", [{ type: "stdout", text: "line2" }]);
    notifier.notify("p1"); // creates pending

    notifier.clear("p1");

    // Advancing time should NOT trigger any emit
    vi.advanceTimersByTime(200);
    expect(emitted).toHaveLength(1); // only the initial one

    vi.useRealTimers();
  });

  it("clearAll removes all pending timers", () => {
    vi.useFakeTimers();
    using notifier = createNotifier(100);
    existingProcesses.add("p1");
    existingProcesses.add("p2");

    notifier.notify("p1");
    notifier.notify("p2");
    expect(emitted).toHaveLength(2);

    // Create pending for both
    appendedLines.set("p1", [{ type: "stdout", text: "x" }]);
    appendedLines.set("p2", [{ type: "stderr", text: "y" }]);
    notifier.notify("p1");
    notifier.notify("p2");

    notifier.clearAll();

    vi.advanceTimersByTime(200);
    expect(emitted).toHaveLength(2); // no new emissions after clearAll

    vi.useRealTimers();
  });

  it("skips emit if process no longer exists when timer fires", () => {
    vi.useFakeTimers();
    using notifier = createNotifier(100);
    existingProcesses.add("p1");

    notifier.notify("p1");
    expect(emitted).toHaveLength(1);

    appendedLines.set("p1", [{ type: "stdout", text: "line2" }]);
    notifier.notify("p1"); // creates pending

    // Process is removed before timer fires
    existingProcesses.delete("p1");

    vi.advanceTimersByTime(150);
    expect(emitted).toHaveLength(1); // no new emit since process gone

    vi.useRealTimers();
  });

  it("dispose clears all pending timers", () => {
    vi.useFakeTimers();
    const notifier = new OutputChangeNotifier({
      emit: (event) => emitted.push(event),
      getAppendedLines: (id) => appendedLines.get(id),
      hasProcess: (id) => existingProcesses.has(id),
      throttleMs: 100,
    });

    existingProcesses.add("p1");
    notifier.notify("p1");
    appendedLines.set("p1", [{ type: "stdout", text: "x" }]);
    notifier.notify("p1"); // pending

    notifier[Symbol.dispose]();

    vi.advanceTimersByTime(200);
    expect(emitted).toHaveLength(1); // only initial, no pending fire

    vi.useRealTimers();
  });
});
