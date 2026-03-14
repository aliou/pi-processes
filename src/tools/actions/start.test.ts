import { existsSync } from "node:fs";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { ProcessManager } from "../../manager";
import { executeStart } from "./start";

function resolveTestShell(): string {
  const candidates = [
    "/run/current-system/sw/bin/bash",
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
  ];

  const shell = candidates.find((candidate) => existsSync(candidate));
  if (!shell) {
    throw new Error("Unable to resolve bash for start action tests");
  }

  return shell;
}

describe("executeStart", () => {
  it("returns a failure result when a log watch regex is invalid", () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      const result = executeStart(
        {
          name: "bad-watch",
          command: "printf 'noop\\n'",
          logWatches: [{ pattern: "(", stream: "stdout" }],
        },
        manager,
        { cwd: process.cwd() } as ExtensionContext,
      );

      expect(result.details.success).toBe(false);
      expect(result.details.message).toMatch(/invalid log watch/i);
    } finally {
      manager.cleanup();
    }
  });
});
