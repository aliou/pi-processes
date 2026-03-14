import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ManagerEvent, ProcessManager } from "./manager";

function resolveTestShell(): string {
  const candidates = [
    "/run/current-system/sw/bin/bash",
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
  ];

  const shell = candidates.find((candidate) => existsSync(candidate));
  if (!shell) {
    throw new Error("Unable to resolve bash for manager tests");
  }

  return shell;
}

function waitForEvent<T extends ManagerEvent>(
  manager: ProcessManager,
  predicate: (event: ManagerEvent) => event is T,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(`Timed out waiting for manager event after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    const unsubscribe = manager.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

describe("ProcessManager log watches", () => {
  it("emits process_log_matched when a stdout line matches a configured log watch", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      const matchPromise = waitForEvent(
        manager,
        (
          event,
        ): event is Extract<ManagerEvent, { type: "process_log_matched" }> =>
          event.type === "process_log_matched",
      );

      manager.start("watch-test", "printf 'server ready\\n'", process.cwd(), {
        logWatches: [{ pattern: "server ready", stream: "stdout" }],
      });

      const event = await matchPromise;

      expect(event.info.name).toBe("watch-test");
      expect(event.match.stream).toBe("stdout");
      expect(event.match.line).toBe("server ready");
      expect(event.match.pattern).toBe("server ready");
      expect(event.match.matchCount).toBe(1);
    } finally {
      manager.cleanup();
    }
  });

  it("matches each watch only once by default", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });
    const matches: Array<
      Extract<ManagerEvent, { type: "process_log_matched" }>
    > = [];

    try {
      const endPromise = waitForEvent(
        manager,
        (event): event is Extract<ManagerEvent, { type: "process_ended" }> =>
          event.type === "process_ended",
      );

      const unsubscribe = manager.onEvent((event) => {
        if (event.type === "process_log_matched") {
          matches.push(event);
        }
      });

      manager.start(
        "watch-once-test",
        "printf 'ready\\nready\\n'",
        process.cwd(),
        {
          logWatches: [{ pattern: "ready", stream: "stdout" }],
        },
      );

      await endPromise;
      unsubscribe();

      expect(matches).toHaveLength(1);
      expect(matches[0]?.match.matchCount).toBe(1);
    } finally {
      manager.cleanup();
    }
  });
});
