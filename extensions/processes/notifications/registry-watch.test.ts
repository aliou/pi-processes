import { describe, expect, it } from "vitest";

import type { LogMatcherConfig, WatchRemoveSpec } from "./registry";
import { createNotificationRegistry } from "./registry";

function makeConfig(logMatches: LogMatcherConfig[] = []) {
  return { logMatches };
}

function assertNotNull<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

describe("NotificationRegistry watch methods", () => {
  describe("appendWatches", () => {
    it("appends matchers to existing list", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "ready" }]));

      const result = assertNotNull(
        registry.appendWatches("proc_1", [
          { pattern: "error" },
          { pattern: "warn" },
        ]),
      );

      expect(result.logMatches).toHaveLength(3);
      expect(result.logMatches[0].pattern).toBe("ready");
      expect(result.logMatches[1].pattern).toBe("error");
      expect(result.logMatches[2].pattern).toBe("warn");
    });

    it("increments revision but not generation", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));

      const before = assertNotNull(registry.getWatchState("proc_1"));
      const after = assertNotNull(
        registry.appendWatches("proc_1", [{ pattern: "b" }]),
      );

      expect(after.revision).toBe(before.revision + 1);
      expect(after.generation).toBe(before.generation);
    });

    it("returns null for unknown process", () => {
      const registry = createNotificationRegistry();
      expect(registry.appendWatches("proc_x", [{ pattern: "a" }])).toBeNull();
    });

    it("enforces max matcher count", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));

      expect(() =>
        registry.appendWatches(
          "proc_1",
          Array.from({ length: 20 }, (_, i) => ({ pattern: `m${i}` })),
        ),
      ).toThrow(/exceed maximum/);
    });
  });

  describe("replaceWatches", () => {
    it("replaces all matchers with new list", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "old" }]));

      const result = assertNotNull(
        registry.replaceWatches("proc_1", [
          { pattern: "new1" },
          { pattern: "new2" },
        ]),
      );

      expect(result.logMatches).toHaveLength(2);
      expect(result.logMatches[0].pattern).toBe("new1");
      expect(result.logMatches[1].pattern).toBe("new2");
    });

    it("increments both revision and generation", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));

      const before = assertNotNull(registry.getWatchState("proc_1"));
      const after = assertNotNull(
        registry.replaceWatches("proc_1", [{ pattern: "b" }]),
      );

      expect(after.revision).toBe(before.revision + 1);
      expect(after.generation).toBe(before.generation + 1);
    });

    it("returns null for unknown process", () => {
      const registry = createNotificationRegistry();
      expect(registry.replaceWatches("proc_x", [{ pattern: "a" }])).toBeNull();
    });
  });

  describe("removeWatches", () => {
    it("removes by index", () => {
      const registry = createNotificationRegistry();
      registry.register(
        "proc_1",
        makeConfig([{ pattern: "a" }, { pattern: "b" }]),
      );

      const result = assertNotNull(
        registry.removeWatches("proc_1", [{ index: 0 }]),
      );

      expect(result.logMatches).toHaveLength(1);
      expect(result.logMatches[0].pattern).toBe("b");
    });

    it("removes by pattern", () => {
      const registry = createNotificationRegistry();
      registry.register(
        "proc_1",
        makeConfig([{ pattern: "a" }, { pattern: "b" }]),
      );

      const result = assertNotNull(
        registry.removeWatches("proc_1", [{ pattern: "a" } as WatchRemoveSpec]),
      );

      expect(result.logMatches).toHaveLength(1);
      expect(result.logMatches[0].pattern).toBe("b");
    });

    it("removes multiple entries matching the same pattern", () => {
      const registry = createNotificationRegistry();
      registry.register(
        "proc_1",
        makeConfig([
          { pattern: "dup" },
          { pattern: "keep" },
          { pattern: "dup", stream: "stderr" },
        ]),
      );

      const result = assertNotNull(
        registry.removeWatches("proc_1", [
          { pattern: "dup" } as WatchRemoveSpec,
        ]),
      );

      expect(result.logMatches).toHaveLength(1);
      expect(result.logMatches[0].pattern).toBe("keep");
    });

    it("removes by pattern with field filters", () => {
      const registry = createNotificationRegistry();
      registry.register(
        "proc_1",
        makeConfig([
          { pattern: "x", stream: "stdout" },
          { pattern: "x", stream: "stderr" },
        ]),
      );

      const result = assertNotNull(
        registry.removeWatches("proc_1", [
          { pattern: "x", stream: "stderr" } as WatchRemoveSpec,
        ]),
      );

      expect(result.logMatches).toHaveLength(1);
      expect(result.logMatches[0].stream).toBe("stdout");
    });

    it("increments revision but not generation", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));

      const before = assertNotNull(registry.getWatchState("proc_1"));
      const after = assertNotNull(
        registry.removeWatches("proc_1", [{ index: 0 }]),
      );

      expect(after.revision).toBe(before.revision + 1);
      expect(after.generation).toBe(before.generation);
    });

    it("returns null for unknown process", () => {
      const registry = createNotificationRegistry();
      expect(registry.removeWatches("proc_x", [{ index: 0 }])).toBeNull();
    });
  });

  describe("clearWatches", () => {
    it("removes all matchers", () => {
      const registry = createNotificationRegistry();
      registry.register(
        "proc_1",
        makeConfig([{ pattern: "a" }, { pattern: "b" }]),
      );

      const result = assertNotNull(registry.clearWatches("proc_1"));

      expect(result.logMatches).toHaveLength(0);
    });

    it("increments both revision and generation", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));

      const before = assertNotNull(registry.getWatchState("proc_1"));
      const after = assertNotNull(registry.clearWatches("proc_1"));

      expect(after.revision).toBe(before.revision + 1);
      expect(after.generation).toBe(before.generation + 1);
    });

    it("returns null for unknown process", () => {
      const registry = createNotificationRegistry();
      expect(registry.clearWatches("proc_x")).toBeNull();
    });
  });

  describe("getWatchState", () => {
    it("returns current watch state", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));

      const state = assertNotNull(registry.getWatchState("proc_1"));

      expect(state.logMatches).toHaveLength(1);
      expect(state.revision).toBe(0);
      expect(state.generation).toBe(0);
    });

    it("returns null for unknown process", () => {
      const registry = createNotificationRegistry();
      expect(registry.getWatchState("proc_x")).toBeNull();
    });

    it("returns defensive copies", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));

      const state1 = assertNotNull(registry.getWatchState("proc_1"));
      const state2 = assertNotNull(registry.getWatchState("proc_1"));

      expect(state1.logMatches).not.toBe(state2.logMatches);
    });
  });

  describe("lifecycle", () => {
    it("clears watch meta on unregister", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));
      registry.appendWatches("proc_1", [{ pattern: "b" }]);

      registry.unregister("proc_1");

      expect(registry.getWatchState("proc_1")).toBeNull();
    });

    it("clears all watch state on clear()", () => {
      const registry = createNotificationRegistry();
      registry.register("proc_1", makeConfig([{ pattern: "a" }]));
      registry.register("proc_2", makeConfig([{ pattern: "b" }]));

      registry.clear();

      expect(registry.getWatchState("proc_1")).toBeNull();
      expect(registry.getWatchState("proc_2")).toBeNull();
    });
  });
});
