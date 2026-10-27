import { describe, expect, it } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import { ProcessFocus } from "./focus-mode";

function makeProcess(
  id: string,
  status: ProcessInfo["status"] = "running",
  startTime = 1000,
): ProcessInfo {
  return {
    id,
    name: id,
    pid: 123,
    command: `echo ${id}`,
    cwd: "/repo",
    startTime,
    endTime: null,
    status,
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: null,
    signal: null,
    errorMessage: null,
  };
}

describe("ProcessFocus", () => {
  it("starts on the first live process", () => {
    const focus = new ProcessFocus();
    const processes = [
      makeProcess("done", "exited"),
      makeProcess("live-2", "running", 2000),
      makeProcess("live-1", "running", 1000),
    ];

    focus.enter(processes, null);

    expect(focus.isActive).toBe(true);
    expect(focus.select(processes)?.id).toBe("live-2");
  });

  it("falls back to the first process when nothing is live", () => {
    const focus = new ProcessFocus();
    const processes = [makeProcess("done", "exited")];

    focus.enter(processes, "prev");

    expect(focus.select(processes)?.id).toBe("done");
  });

  it("clamps movement to the row bounds", () => {
    const focus = new ProcessFocus();
    const processes = [makeProcess("a"), makeProcess("b")];
    focus.enter(processes, null);

    focus.move(-1, processes);
    expect(focus.select(processes)?.id).toBe("a");

    focus.move(1, processes);
    focus.move(1, processes);
    expect(focus.select(processes)?.id).toBe("b");
  });

  it("keeps the selection stable when the list is reordered", () => {
    const focus = new ProcessFocus();
    const first = [makeProcess("a"), makeProcess("b"), makeProcess("c")];
    focus.enter(first, null);
    focus.move(1, first);

    const reordered = [makeProcess("c"), makeProcess("a"), makeProcess("b")];
    expect(focus.select(reordered)?.id).toBe("b");

    focus.move(1, reordered);
    expect(focus.select(reordered)?.id).toBe("b");

    focus.move(-1, reordered);
    expect(focus.select(reordered)?.id).toBe("a");
  });

  it("selects nothing once the selected process is removed", () => {
    const focus = new ProcessFocus();
    const processes = [makeProcess("a"), makeProcess("b", "running", 2000)];
    focus.enter(processes, null);
    focus.move(1, processes);
    expect(focus.select(processes)?.id).toBe("b");

    const remaining = [makeProcess("a"), makeProcess("gone", "exited")];
    expect(focus.select(remaining)).toBeNull();
  });

  it("restores the previously focused process on exit", () => {
    const focus = new ProcessFocus();
    focus.enter([makeProcess("a")], "prev");

    expect(focus.exit()).toBe("prev");
    expect(focus.isActive).toBe(false);
  });
});
