import { describe, expect, it } from "vitest";

import { buildOutput, watchPatternsForStartedProcess } from "./harness";

const start = {
  action: "start",
  process: { id: "proc_worker", pid: 42, status: "running" },
  notify: { logMatches: [] },
};

function outputWith(
  ...results: { details: Record<string, unknown>; isError?: boolean }[]
) {
  return buildOutput("", {
    messages: results.map((result) => ({
      role: "toolResult",
      toolName: "process",
      ...result,
    })) as Parameters<typeof buildOutput>[1]["messages"],
    getActiveToolNames: () => ["process"],
  });
}

describe("process eval result guards", () => {
  it.each([
    { pid: null, status: "failed", endReason: "missing_pid" },
    { pid: 0, status: "running", endReason: null },
    { pid: 42, status: "failed", endReason: "spawn_error" },
    { pid: 42, status: "exited", endReason: "exit" },
  ])("does not count a non-running start: %j", (process) => {
    const output = outputWith({
      details: { ...start, process: { id: "proc_worker", ...process } },
      isError: false,
    });

    expect(output.successfulStarts).toBe(0);
  });

  it("counts a returned running process with a positive PID", () => {
    expect(outputWith({ details: start }).successfulStarts).toBe(1);
  });

  it("does not count an error result even with running details", () => {
    expect(outputWith({ details: start, isError: true }).successfulStarts).toBe(
      0,
    );
  });

  it.each([
    { ok: false, id: "proc_worker", isError: false },
    { ok: true, id: "proc_other", isError: false },
    { ok: true, id: "proc_worker", isError: true },
  ])("rejects an unapplied or unrelated watch update: %j", (update) => {
    const output = outputWith(
      { details: start },
      {
        isError: update.isError,
        details: {
          action: "update",
          ok: update.ok,
          process: { id: update.id },
          watches: { items: [{ pattern: "Listening" }, { pattern: "FATAL" }] },
        },
      },
    );

    expect(watchPatternsForStartedProcess(output.processResults)).toEqual([]);
    expect(watchPatternsForStartedProcess(output.processResults, true)).toEqual(
      [],
    );
  });

  it("uses accepted watches on the started process", () => {
    const output = outputWith(
      {
        details: {
          ...start,
          notify: { logMatches: [{ pattern: "Listening" }] },
        },
      },
      {
        details: {
          action: "update",
          ok: true,
          process: { id: "proc_worker" },
          watches: { items: [{ pattern: "FATAL" }] },
        },
      },
    );

    expect(watchPatternsForStartedProcess(output.processResults)).toEqual([
      "Listening",
      "FATAL",
    ]);
    expect(watchPatternsForStartedProcess(output.processResults, true)).toEqual(
      ["FATAL"],
    );
  });
});
