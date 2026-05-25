import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import { executeStart } from ".";

const processInfo: ProcessInfo = {
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

const ctx = { cwd: "/repo" } as ExtensionContext;

describe("executeStart", () => {
  it("validates notify before starting the process", () => {
    const start = vi.fn(() => processInfo);
    const manager = { start } as unknown as ProcessManager;

    expect(() =>
      executeStart(
        {
          action: "start",
          name: "dev",
          command: "pnpm dev",
          notify: { logMatches: [{ pattern: "[", mode: "regex" }] },
        },
        manager,
        ctx,
      ),
    ).toThrow(/not a valid regular expression/);

    expect(start).not.toHaveBeenCalled();
  });

  it("returns normalized notify config in start details", () => {
    const start = vi.fn(() => processInfo);
    const manager = { start } as unknown as ProcessManager;

    const details = executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
        notify: { logMatches: [{ pattern: "ready" }] },
      },
      manager,
      ctx,
    );

    expect(start).toHaveBeenCalledWith("dev", "pnpm dev", "/repo");
    expect(details.notify).toEqual({
      onSuccess: "context",
      onFailure: "turn",
      onKilled: "ignore",
      logMatches: [
        {
          pattern: "ready",
          mode: "literal",
          stream: "both",
          repeat: false,
          on: "turn",
        },
      ],
    });
  });
});
