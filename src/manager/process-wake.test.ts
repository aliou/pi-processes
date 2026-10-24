import { describe, expect, it } from "vitest";

import type { ManagerEvent } from "../types";
import { ProcessWakeController } from "./process-wake";

function assertNotNull<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

interface FakeRecord {
  id: string;
  status: string;
}

function createFakeRegistry(records: FakeRecord[] = []) {
  const byId = new Map(records.map((record) => [record.id, record]));
  return {
    getRecord: (id: string) => byId.get(id),
    list: () =>
      Array.from(byId.values()).map((record) => ({
        id: record.id,
        status: record.status,
      })),
  };
}

function createController(records: FakeRecord[] = []): {
  controller: ProcessWakeController;
  emitted: ManagerEvent[];
} {
  const emitted: ManagerEvent[] = [];
  const controller = new ProcessWakeController({
    emit: (event) => {
      emitted.push(event);
    },
    registry: createFakeRegistry(records) as never,
  });
  return { controller, emitted };
}

function outputEvent(
  id: string,
  lines: Array<{ type: "stdout" | "stderr"; text: string }>,
): ManagerEvent & { type: "process_output_changed" } {
  return {
    type: "process_output_changed",
    id,
    appendedText: lines,
  };
}

describe("ProcessWakeController watch mutations", () => {
  describe("appendWatches", () => {
    it("appends matchers to existing list", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "ready" }],
      });

      const result = controller.appendWatches("proc_1", [
        { pattern: "error" },
        { pattern: "warn" },
      ]);

      expect(result?.logMatches).toHaveLength(3);
      expect(result?.logMatches[0].pattern).toBe("ready");
      expect(result?.logMatches[1].pattern).toBe("error");
      expect(result?.logMatches[2].pattern).toBe("warn");
    });

    it("increments revision but not generation", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });

      const before = controller.getWatchState("proc_1");
      const after = controller.appendWatches("proc_1", [{ pattern: "b" }]);

      expect(after?.revision).toBe(assertNotNull(before).revision + 1);
      expect(after?.generation).toBe(assertNotNull(before).generation);
    });

    it("returns null for unknown process", () => {
      const { controller } = createController();
      expect(controller.appendWatches("proc_x", [{ pattern: "a" }])).toBeNull();
    });

    it("enforces max matcher count", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });

      expect(() =>
        controller.appendWatches(
          "proc_1",
          Array.from({ length: 20 }, (_, i) => ({ pattern: `m${i}` })),
        ),
      ).toThrow(/exceed maximum/);
    });
  });

  describe("replaceWatches", () => {
    it("replaces all matchers with new list", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "old" }],
      });

      const result = controller.replaceWatches("proc_1", [
        { pattern: "new1" },
        { pattern: "new2" },
      ]);

      expect(result?.logMatches).toHaveLength(2);
      expect(result?.logMatches[0].pattern).toBe("new1");
      expect(result?.logMatches[1].pattern).toBe("new2");
    });

    it("increments both revision and generation", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });

      const before = controller.getWatchState("proc_1");
      const after = controller.replaceWatches("proc_1", [{ pattern: "b" }]);

      expect(after?.revision).toBe(assertNotNull(before).revision + 1);
      expect(after?.generation).toBe(assertNotNull(before).generation + 1);
    });

    it("returns null for unknown process", () => {
      const { controller } = createController();
      expect(
        controller.replaceWatches("proc_x", [{ pattern: "a" }]),
      ).toBeNull();
    });
  });

  describe("removeWatches", () => {
    it("removes by index", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }, { pattern: "b" }],
      });

      const result = controller.removeWatches("proc_1", [{ index: 0 }]);

      expect(result?.logMatches).toHaveLength(1);
      expect(result?.logMatches[0].pattern).toBe("b");
    });

    it("removes by pattern", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }, { pattern: "b" }],
      });

      const result = controller.removeWatches("proc_1", [{ pattern: "a" }]);

      expect(result?.logMatches).toHaveLength(1);
      expect(result?.logMatches[0].pattern).toBe("b");
    });

    it("removes multiple entries matching the same pattern", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [
          { pattern: "dup" },
          { pattern: "keep" },
          { pattern: "dup", stream: "stderr" },
        ],
      });

      const result = controller.removeWatches("proc_1", [{ pattern: "dup" }]);

      expect(result?.logMatches).toHaveLength(1);
      expect(result?.logMatches[0].pattern).toBe("keep");
    });

    it("removes by pattern with field filters", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [
          { pattern: "x", stream: "stdout" },
          { pattern: "x", stream: "stderr" },
        ],
      });

      const result = controller.removeWatches("proc_1", [
        { pattern: "x", stream: "stderr" },
      ]);

      expect(result?.logMatches).toHaveLength(1);
      expect(result?.logMatches[0].stream).toBe("stdout");
    });

    it("increments revision but not generation", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });

      const before = controller.getWatchState("proc_1");
      const after = controller.removeWatches("proc_1", [{ index: 0 }]);

      expect(after?.revision).toBe(assertNotNull(before).revision + 1);
      expect(after?.generation).toBe(assertNotNull(before).generation);
    });

    it("returns null for unknown process", () => {
      const { controller } = createController();
      expect(controller.removeWatches("proc_x", [{ index: 0 }])).toBeNull();
    });
  });

  describe("clearWatches", () => {
    it("removes all matchers", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }, { pattern: "b" }],
      });

      const result = controller.clearWatches("proc_1");

      expect(result?.logMatches).toHaveLength(0);
    });

    it("increments both revision and generation", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });

      const before = controller.getWatchState("proc_1");
      const after = controller.clearWatches("proc_1");

      expect(after?.revision).toBe(assertNotNull(before).revision + 1);
      expect(after?.generation).toBe(assertNotNull(before).generation + 1);
    });

    it("returns null for unknown process", () => {
      const { controller } = createController();
      expect(controller.clearWatches("proc_x")).toBeNull();
    });
  });

  describe("getWatchState", () => {
    it("returns current watch state", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });

      const state = controller.getWatchState("proc_1");

      expect(state?.logMatches).toHaveLength(1);
      expect(state?.revision).toBe(0);
      expect(state?.generation).toBe(0);
    });

    it("returns null for unknown process", () => {
      const { controller } = createController();
      expect(controller.getWatchState("proc_x")).toBeNull();
    });

    it("returns defensive copies", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });

      const state1 = controller.getWatchState("proc_1");
      const state2 = controller.getWatchState("proc_1");

      expect(state1?.logMatches).not.toBe(state2?.logMatches);
    });
  });

  describe("lifecycle", () => {
    it("clears watch state on handleProcessEnded", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });
      controller.appendWatches("proc_1", [{ pattern: "b" }]);

      controller.handleProcessEnded("proc_1");

      expect(controller.getWatchState("proc_1")).toBeNull();
      expect(controller.getWakeConfig("proc_1")).toBeNull();
    });

    it("clears all watch state on clear()", () => {
      const { controller } = createController();
      controller.registerWakeConfig("proc_1", {
        logMatches: [{ pattern: "a" }],
      });
      controller.registerWakeConfig("proc_2", {
        logMatches: [{ pattern: "b" }],
      });

      controller.clear();

      expect(controller.getWatchState("proc_1")).toBeNull();
      expect(controller.getWatchState("proc_2")).toBeNull();
    });
  });
});

describe("ProcessWakeController intentional stops", () => {
  it("consumes an intentional stop marker exactly once", () => {
    const { controller } = createController();
    controller.markIntentionalStop("proc_1");

    expect(controller.consumeIntentionalStop("proc_1")).toBe(true);
    expect(controller.consumeIntentionalStop("proc_1")).toBe(false);
  });

  it("handleProcessEnded clears pending intentional stop markers", () => {
    const { controller } = createController();
    controller.markIntentionalStop("proc_1");

    controller.handleProcessEnded("proc_1");

    expect(controller.consumeIntentionalStop("proc_1")).toBe(false);
  });
});

describe("ProcessWakeController wake conditions", () => {
  it("returns default exit attentions and no watches for an unregistered live process", () => {
    const { controller } = createController([
      { id: "proc_1", status: "running" },
    ]);

    expect(controller.getWakeConditions("proc_1")).toEqual({
      exitAttention: { success: "turn", failure: "turn", killed: "context" },
      watches: [],
    });
  });

  it("resolves exit attentions from the registered wake config", () => {
    const { controller } = createController([
      { id: "proc_1", status: "running" },
    ]);
    controller.registerWakeConfig("proc_1", {
      onSuccess: "context",
      onFailure: "ignore",
      onKilled: "turn",
    });

    expect(controller.getWakeConditions("proc_1")?.exitAttention).toEqual({
      success: "context",
      failure: "ignore",
      killed: "turn",
    });
  });

  it("reports configured watches with defaults resolved and not yet fired", () => {
    const { controller } = createController([
      { id: "proc_1", status: "running" },
    ]);
    controller.registerWakeConfig("proc_1", {
      logMatches: [
        { pattern: "ready" },
        {
          pattern: "error",
          mode: "regex",
          stream: "stderr",
          repeat: true,
          on: "context",
        },
      ],
    });

    expect(controller.getWakeConditions("proc_1")?.watches).toEqual([
      {
        pattern: "ready",
        mode: "literal",
        stream: "both",
        repeat: false,
        on: "turn",
        fired: false,
      },
      {
        pattern: "error",
        mode: "regex",
        stream: "stderr",
        repeat: true,
        on: "context",
        fired: false,
      },
    ]);
  });

  it("marks a one-shot watch as fired after its pattern matches", () => {
    const { controller } = createController([
      { id: "proc_1", status: "running" },
    ]);
    controller.registerWakeConfig("proc_1", {
      logMatches: [{ pattern: "ready" }, { pattern: "listening" }],
    });

    controller.handleOutputChanged(
      outputEvent("proc_1", [{ type: "stdout", text: "ready on port 3000" }]),
    );

    const watches = controller.getWakeConditions("proc_1")?.watches;
    expect(watches?.[0]).toMatchObject({ pattern: "ready", fired: true });
    expect(watches?.[1]).toMatchObject({
      pattern: "listening",
      fired: false,
    });
  });

  it("keeps fired state when watches are appended and the config recompiles", () => {
    const { controller } = createController([
      { id: "proc_1", status: "running" },
    ]);
    controller.registerWakeConfig("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    controller.handleOutputChanged(
      outputEvent("proc_1", [{ type: "stdout", text: "ready" }]),
    );

    controller.appendWatches("proc_1", [{ pattern: "listening" }]);

    const watches = controller.getWakeConditions("proc_1")?.watches;
    expect(watches).toHaveLength(2);
    expect(watches?.[0]).toMatchObject({ pattern: "ready", fired: true });
    expect(watches?.[1]).toMatchObject({
      pattern: "listening",
      fired: false,
    });
  });

  it("drops removed watches from the reported wake conditions", () => {
    const { controller } = createController([
      { id: "proc_1", status: "running" },
    ]);
    controller.registerWakeConfig("proc_1", {
      logMatches: [{ pattern: "ready" }, { pattern: "error" }],
    });

    controller.handleOutputChanged(
      outputEvent("proc_1", [{ type: "stdout", text: "error: boom" }]),
    );

    controller.removeWatches("proc_1", [{ pattern: "error" }]);

    expect(controller.getWakeConditions("proc_1")?.watches).toEqual([
      {
        pattern: "ready",
        mode: "literal",
        stream: "both",
        repeat: false,
        on: "turn",
        fired: false,
      },
    ]);
  });

  it("returns null for unknown processes", () => {
    const { controller } = createController();
    expect(controller.getWakeConditions("proc_x")).toBeNull();
  });

  it("returns null for ended processes", () => {
    const { controller } = createController([
      { id: "proc_1", status: "exited" },
    ]);
    controller.registerWakeConfig("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    expect(controller.getWakeConditions("proc_1")).toBeNull();
  });
});

describe("ProcessWakeController listWithWake", () => {
  it("attaches wake conditions to live processes only", () => {
    const { controller } = createController([
      { id: "proc_1", status: "running" },
      { id: "proc_2", status: "terminating" },
      { id: "proc_3", status: "exited" },
      { id: "proc_4", status: "killed" },
    ]);
    controller.registerWakeConfig("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    const entries = controller.listWithWake();

    expect(entries).toHaveLength(4);
    expect(entries[0].wake?.watches).toEqual([
      expect.objectContaining({ pattern: "ready" }),
    ]);
    expect(entries[1].wake?.exitAttention).toEqual({
      success: "turn",
      failure: "turn",
      killed: "context",
    });
    expect("wake" in entries[2] && entries[2].wake !== undefined).toBe(false);
    expect("wake" in entries[3] && entries[3].wake !== undefined).toBe(false);
  });

  it("returns shallow copies that do not alias registry entries", () => {
    const { controller } = createController([
      { id: "proc_1", status: "running" },
    ]);

    const [entry] = controller.listWithWake();
    const [again] = controller.listWithWake();

    expect(entry).not.toBe(again);
    expect(entry.id).toBe("proc_1");
  });
});

describe("ProcessWakeController watch evaluation", () => {
  it("emits a process_watch_matched event when a watch matches", () => {
    const { controller, emitted } = createController();
    controller.registerWakeConfig("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    controller.handleOutputChanged(
      outputEvent("proc_1", [
        { type: "stdout", text: "booting\nserver ready\n" },
      ]),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      type: "process_watch_matched",
      id: "proc_1",
      matches: [
        {
          matcherIndex: 0,
          pattern: "ready",
          mode: "literal",
          stream: "stdout",
          line: "server ready",
          on: "turn",
        },
      ],
    });
  });

  it("does not emit for output without appended text", () => {
    const { controller, emitted } = createController();
    controller.registerWakeConfig("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    controller.handleOutputChanged({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: undefined,
    });

    expect(emitted).toHaveLength(0);
  });

  it("does not emit for a process without a wake config", () => {
    const { controller, emitted } = createController();

    controller.handleOutputChanged(
      outputEvent("proc_1", [{ type: "stdout", text: "ready" }]),
    );

    expect(emitted).toHaveLength(0);
  });

  it("does not emit after the process has ended and its state was cleared", () => {
    const { controller, emitted } = createController();
    controller.registerWakeConfig("proc_1", {
      logMatches: [{ pattern: "warning", repeat: true }],
    });

    controller.handleOutputChanged(
      outputEvent("proc_1", [{ type: "stdout", text: "warning: something" }]),
    );
    expect(emitted).toHaveLength(1);

    controller.handleProcessEnded("proc_1");

    controller.handleOutputChanged(
      outputEvent("proc_1", [{ type: "stdout", text: "warning: stale" }]),
    );
    expect(emitted).toHaveLength(1);
  });

  it("resolves watch attention defaults from the configured spec", () => {
    const { controller, emitted } = createController();
    controller.registerWakeConfig("proc_1", {
      logMatches: [
        { pattern: "ready" },
        { pattern: "error", on: "context" },
        { pattern: "warn", on: "ignore" },
      ],
    });

    controller.handleOutputChanged(
      outputEvent("proc_1", [{ type: "stdout", text: "ready\nerror\nwarn" }]),
    );

    expect(emitted[0]).toMatchObject({
      type: "process_watch_matched",
      matches: [
        expect.objectContaining({ pattern: "ready", on: "turn" }),
        expect.objectContaining({ pattern: "error", on: "context" }),
        expect.objectContaining({ pattern: "warn", on: "ignore" }),
      ],
    });
  });
});
