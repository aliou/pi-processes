import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import type { NotificationRegistry } from "../../notifications/registry";
import { createNotificationRegistry } from "../../notifications/registry";
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

function createFakeRegistry(): NotificationRegistry {
  return createNotificationRegistry();
}

describe("executeStart", () => {
  it("validates notify before starting the process", () => {
    const start = vi.fn(() => processInfo);
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

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
        registry,
      ),
    ).toThrow(/not a valid regular expression/);

    expect(start).not.toHaveBeenCalled();
  });

  it("returns normalized notify config in start details", () => {
    const start = vi.fn(() => processInfo);
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    const details = executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
        notify: { logMatches: [{ pattern: "ready" }] },
      },
      manager,
      ctx,
      registry,
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

  it("registers notify config with the notification registry after successful start", () => {
    const start = vi.fn(() => processInfo);
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    const notify = { logMatches: [{ pattern: "ready" }] };
    executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
        notify,
      },
      manager,
      ctx,
      registry,
    );

    const registered = registry.get("proc_1");
    expect(registered).not.toBeNull();
    expect(registered?.onSuccess).toBe("context");
    expect(registered?.onFailure).toBe("turn");
    expect(registered?.onKilled).toBe("ignore");
    expect(registered?.logMatches).toHaveLength(1);
    expect(registered?.logMatches?.[0]?.pattern).toBe("ready");
  });

  it("does not register notify config when validation fails", () => {
    const start = vi.fn(() => processInfo);
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

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
        registry,
      ),
    ).toThrow(/not a valid regular expression/);

    expect(registry.get("proc_1")).toBeNull();
  });
});
