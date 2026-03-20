import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { configLoader } from "../../config";
import type { ManagerEvent } from "../../constants";
import { ProcessManager } from "../../manager";
import { executeOutput } from "./output";

function resolveTestShell(): string {
  const candidates = [
    "/run/current-system/sw/bin/bash",
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
  ];

  const shell = candidates.find((candidate) => existsSync(candidate));
  if (!shell) {
    throw new Error("Unable to resolve bash for output action tests");
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

describe("executeOutput", () => {
  it("prefers the newest live process when multiple processes share a name", async () => {
    await configLoader.load();
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      manager.start("docs-ide", "printf 'old-output\\n'", process.cwd());

      await waitForEvent(
        manager,
        (event): event is Extract<ManagerEvent, { type: "process_ended" }> =>
          event.type === "process_ended",
      );

      const second = manager.start(
        "docs-ide",
        "node -e \"process.stdout.write('new-output\\n'); setTimeout(() => {}, 1000)\"",
        process.cwd(),
      );

      await waitForEvent(
        manager,
        (
          event,
        ): event is Extract<ManagerEvent, { type: "process_output_changed" }> =>
          event.type === "process_output_changed" &&
          event.info.id === second.id,
      );

      const result = executeOutput({ id: "docs-ide" }, manager);
      const text =
        result.content[0]?.type === "text" ? result.content[0].text : "";

      expect(result.details.success).toBe(true);
      expect(result.details.message).toContain(`(${second.id})`);
      expect(text).toContain("new-output");
      expect(text).not.toContain("old-output");
    } finally {
      manager.cleanup();
    }
  });
});
