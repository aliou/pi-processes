import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import type { NotificationRegistry } from "../../notifications/registry";
import { createNotificationRegistry } from "../../notifications/registry";
import { executeUpdate, formatUpdateDetails } from ".";

const runningProcess: ProcessInfo = {
  id: "proc_1",
  name: "dev",
  pid: 123,
  command: "pnpm dev",
  cwd: "/repo",
  startTime: 1000,
  endTime: null,
  status: "running",
  exitCode: null,
  success: null,
  stdoutFile: "/tmp/stdout.log",
  stderrFile: "/tmp/stderr.log",
  endReason: null,
  signal: null,
  errorMessage: null,
};

const exitedProcess: ProcessInfo = {
  ...runningProcess,
  status: "exited",
  exitCode: 0,
  success: true,
  endTime: 2000,
};

function createFakeManager(getReturn: ProcessInfo | null = runningProcess) {
  return {
    get: (_id: string) => getReturn,
    rename: vi.fn((_id: string, name: string) => {
      if (!getReturn) return null;
      return { ...getReturn, name };
    }),
  } as unknown as ProcessManager;
}

function createFakeRegistry(): NotificationRegistry {
  return createNotificationRegistry();
}

describe("executeUpdate", () => {
  describe("validation", () => {
    it("returns error when id is missing", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      const details = executeUpdate({ action: "update" }, manager, registry);

      expect(details.ok).toBe(false);
      expect(details.error).toBe("process update requires id");
    });

    it("returns error for unknown process", () => {
      const manager = createFakeManager(null);
      const registry = createFakeRegistry();

      const details = executeUpdate(
        { action: "update", id: "proc_1" },
        manager,
        registry,
      );

      expect(details.ok).toBe(false);
      expect(details.error).toBe("process not found: proc_1");
    });

    it("returns error for non-running process", () => {
      const manager = createFakeManager(exitedProcess);
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      const details = executeUpdate(
        { action: "update", id: "proc_1" },
        manager,
        registry,
      );

      expect(details.ok).toBe(false);
      expect(details.error).toContain("requires a running process");
    });
  });

  describe("rename", () => {
    it("renames a running process", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      const details = executeUpdate(
        { action: "update", id: "proc_1", name: "build" },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.renamed).toBe(true);
      expect(details.previousName).toBe("dev");
      expect(details.process?.name).toBe("build");
    });

    it("reports no rename when name is unchanged", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      const details = executeUpdate(
        { action: "update", id: "proc_1", name: "dev" },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.renamed).toBe(false);
      expect(details.previousName).toBeNull();
    });

    it("returns error for empty name", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      const details = executeUpdate(
        { action: "update", id: "proc_1", name: "  " },
        manager,
        registry,
      );

      expect(details.ok).toBe(false);
      expect(details.error).toBe("process update name must be non-empty");
    });
  });

  describe("watches", () => {
    it("returns null watch mode when no watches param", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      const details = executeUpdate(
        { action: "update", id: "proc_1", name: "new-name" },
        manager,
        registry,
      );

      expect(details.watches.mode).toBeNull();
    });

    it("appends watches to existing matchers", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {
        logMatches: [{ pattern: "ready" }],
      });

      const details = executeUpdate(
        {
          action: "update",
          id: "proc_1",
          watches: {
            mode: "append",
            items: [{ pattern: "error", mode: "literal", stream: "stderr" }],
          },
        },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.watches.mode).toBe("append");
      expect(details.watches.count).toBe(2);
      expect(details.watches.items[0].pattern).toBe("ready");
      expect(details.watches.items[1].pattern).toBe("error");
    });

    it("replaces all watches", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {
        logMatches: [{ pattern: "ready" }, { pattern: "listening" }],
      });

      const details = executeUpdate(
        {
          action: "update",
          id: "proc_1",
          watches: {
            mode: "replace",
            items: [{ pattern: "error" }],
          },
        },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.watches.mode).toBe("replace");
      expect(details.watches.before).toEqual([
        { pattern: "ready" },
        { pattern: "listening" },
      ]);
      expect(details.watches.count).toBe(1);
      expect(details.watches.items[0].pattern).toBe("error");
    });

    it("clears all watches", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {
        logMatches: [{ pattern: "ready" }],
      });

      const details = executeUpdate(
        {
          action: "update",
          id: "proc_1",
          watches: { mode: "clear" },
        },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.watches.mode).toBe("clear");
      expect(details.watches.count).toBe(0);
    });

    it("removes watches by index", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {
        logMatches: [{ pattern: "ready" }, { pattern: "error" }],
      });

      const details = executeUpdate(
        {
          action: "update",
          id: "proc_1",
          watches: {
            mode: "remove",
            items: [{ index: 0 }],
          },
        },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.watches.mode).toBe("remove");
      expect(details.watches.count).toBe(1);
      expect(details.watches.items[0].pattern).toBe("error");
    });

    it("removes watches by pattern", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {
        logMatches: [{ pattern: "ready" }, { pattern: "error" }],
      });

      const details = executeUpdate(
        {
          action: "update",
          id: "proc_1",
          watches: {
            mode: "remove",
            items: [{ pattern: "ready" }],
          },
        },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.watches.count).toBe(1);
      expect(details.watches.items[0].pattern).toBe("error");
    });

    it("removes multiple watches matching the same pattern", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {
        logMatches: [
          { pattern: "ready" },
          { pattern: "error" },
          { pattern: "ready", stream: "stderr" },
        ],
      });

      const details = executeUpdate(
        {
          action: "update",
          id: "proc_1",
          watches: {
            mode: "remove",
            items: [{ pattern: "ready" }],
          },
        },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.watches.count).toBe(1);
      expect(details.watches.items[0].pattern).toBe("error");
    });

    it("removes watches by pattern with stream filter", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {
        logMatches: [
          { pattern: "ready", stream: "stdout" },
          { pattern: "ready", stream: "stderr" },
        ],
      });

      const details = executeUpdate(
        {
          action: "update",
          id: "proc_1",
          watches: {
            mode: "remove",
            items: [{ pattern: "ready", stream: "stderr" }],
          },
        },
        manager,
        registry,
      );

      expect(details.ok).toBe(true);
      expect(details.watches.count).toBe(1);
      expect(details.watches.items[0].stream).toBe("stdout");
    });

    it("requires items for non-clear modes", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      expect(() =>
        executeUpdate(
          {
            action: "update",
            id: "proc_1",
            watches: { mode: "append", items: [] },
          },
          manager,
          registry,
        ),
      ).toThrow("process update watches.items is required for mode=append");
    });

    it("requires pattern or index for remove items", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      expect(() =>
        executeUpdate(
          {
            action: "update",
            id: "proc_1",
            watches: {
              mode: "remove",
              items: [{}],
            },
          },
          manager,
          registry,
        ),
      ).toThrow("requires either index or pattern");
    });

    it("rejects empty pattern in remove items", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();
      registry.register("proc_1", {});

      expect(() =>
        executeUpdate(
          {
            action: "update",
            id: "proc_1",
            watches: {
              mode: "remove",
              items: [{ pattern: "  " }],
            },
          },
          manager,
          registry,
        ),
      ).toThrow("must not be empty");
    });

    it("returns error when watch update targets unregistered notification config", () => {
      const manager = createFakeManager();
      const registry = createFakeRegistry();

      const details = executeUpdate(
        {
          action: "update",
          id: "proc_1",
          watches: { mode: "clear" },
        },
        manager,
        registry,
      );

      expect(details.ok).toBe(false);
      expect(details.error).toContain("could not update watches");
    });
  });
});

describe("formatUpdateDetails", () => {
  it("formats error", () => {
    const details = {
      action: "update" as const,
      ok: false,
      error: "process not found: proc_missing",
      renamed: false,
      previousName: null,
      watches: { mode: null, before: [], applied: [], count: 0, items: [] },
    };

    expect(formatUpdateDetails(details)).toBe(
      "process not found: proc_missing",
    );
  });

  it("formats rename", () => {
    const details = {
      action: "update" as const,
      ok: true,
      process: { ...runningProcess, name: "build" },
      renamed: true,
      previousName: "dev",
      watches: { mode: null, before: [], applied: [], count: 0, items: [] },
    };

    expect(formatUpdateDetails(details)).toBe(
      'Renamed process from "dev" to "build" (proc_1).',
    );
  });

  it("formats append", () => {
    const details = {
      action: "update" as const,
      ok: true,
      process: runningProcess,
      renamed: false,
      previousName: null,
      watches: {
        mode: "append" as const,
        before: [{ pattern: "ready" }],
        applied: [{ pattern: "error" }],
        count: 2,
        items: [],
      },
    };

    expect(formatUpdateDetails(details)).toBe(
      "Updated process dev (proc_1). Appended 1 watch; 2 active.",
    );
  });

  it("formats replace", () => {
    const details = {
      action: "update" as const,
      ok: true,
      process: runningProcess,
      renamed: false,
      previousName: null,
      watches: {
        mode: "replace" as const,
        before: [{ pattern: "ready" }, { pattern: "warn" }],
        applied: [{ pattern: "error" }],
        count: 1,
        items: [],
      },
    };

    expect(formatUpdateDetails(details)).toBe(
      "Updated process dev (proc_1). Replaced 2 with 1 watch; 1 active.",
    );
  });

  it("formats remove", () => {
    const details = {
      action: "update" as const,
      ok: true,
      process: runningProcess,
      renamed: false,
      previousName: null,
      watches: {
        mode: "remove" as const,
        before: [{ pattern: "ready" }, { pattern: "error" }],
        applied: [],
        count: 1,
        items: [{ pattern: "error" }],
      },
    };

    expect(formatUpdateDetails(details)).toBe(
      "Updated process dev (proc_1). Removed 1 watch; 1 active.",
    );
  });

  it("formats clear", () => {
    const details = {
      action: "update" as const,
      ok: true,
      process: runningProcess,
      renamed: false,
      previousName: null,
      watches: {
        mode: "clear" as const,
        before: [{ pattern: "ready" }],
        applied: [],
        count: 0,
        items: [],
      },
    };

    expect(formatUpdateDetails(details)).toBe(
      "Updated process dev (proc_1). Cleared 1 watch; 0 active.",
    );
  });

  it("formats rename with watch update", () => {
    const details = {
      action: "update" as const,
      ok: true,
      process: { ...runningProcess, name: "build" },
      renamed: true,
      previousName: "dev",
      watches: {
        mode: "append" as const,
        before: [],
        applied: [{ pattern: "error" }],
        count: 1,
        items: [{ pattern: "error" }],
      },
    };

    expect(formatUpdateDetails(details)).toBe(
      'Renamed process from "dev" to "build" (proc_1). Appended 1 watch; 1 active.',
    );
  });
});
