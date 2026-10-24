import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import { executeStart, formatStartDetails } from ".";

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

const ctx = {
  cwd: "/repo",
  sessionManager: {
    getSessionId: () => "session-123",
    getSessionFile: () => "/tmp/session-123.jsonl",
  },
} as ExtensionContext;

function createManager(start: ReturnType<typeof vi.fn>): ProcessManager {
  const manager = new ProcessManager();
  vi.spyOn(manager, "start").mockImplementation(start as never);
  return manager;
}

describe("executeStart", () => {
  it("validates notify before starting the process", () => {
    const start = vi.fn(() => processInfo);
    const manager = createManager(start);

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
    manager.cleanup();
  });

  it("returns normalized notify config in start details", () => {
    const start = vi.fn(() => processInfo);
    const manager = createManager(start);

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

    expect(start).toHaveBeenCalledWith(
      "dev",
      "pnpm dev",
      "/repo",
      expect.anything(),
    );
    expect(details.notify).toEqual({
      onSuccess: "turn",
      onFailure: "turn",
      onKilled: "context",
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
    manager.cleanup();
  });

  it("registers wake config with the manager after successful start", () => {
    const start = vi.fn(() => processInfo);
    const manager = createManager(start);

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
    );

    const registered = manager.getWakeConfig("proc_1");
    expect(registered).not.toBeNull();
    expect(registered?.onSuccess).toBe("turn");
    expect(registered?.onFailure).toBe("turn");
    expect(registered?.onKilled).toBe("context");
    expect(registered?.logMatches).toHaveLength(1);
    expect(registered?.logMatches?.[0]?.pattern).toBe("ready");
    manager.cleanup();
  });

  it("does not register wake config when validation fails", () => {
    const start = vi.fn(() => processInfo);
    const manager = createManager(start);

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

    expect(manager.getWakeConfig("proc_1")).toBeNull();
    manager.cleanup();
  });

  it("starts with the explicit cwd when provided", () => {
    const start = vi.fn(() => ({ ...processInfo, cwd: "/explicit" }));
    const manager = createManager(start);

    const details = executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
        cwd: "/explicit",
      },
      manager,
      ctx,
    );

    expect(start).toHaveBeenCalledWith(
      "dev",
      "pnpm dev",
      "/explicit",
      expect.anything(),
    );
    expect(details.process.cwd).toBe("/explicit");
    manager.cleanup();
  });

  it("falls back to ctx.cwd when cwd is not provided", () => {
    const start = vi.fn(() => ({ ...processInfo, cwd: "/repo" }));
    const manager = createManager(start);

    executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
      },
      manager,
      ctx,
    );

    expect(start).toHaveBeenCalledWith(
      "dev",
      "pnpm dev",
      "/repo",
      expect.anything(),
    );
    manager.cleanup();
  });

  it("starts with PI_* session variables injected into the child env", () => {
    const start = vi.fn((..._args: unknown[]) => processInfo);
    const manager = createManager(start);

    executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
      },
      manager,
      ctx,
    );

    const env = start.mock.calls[0]?.[3] as NodeJS.ProcessEnv;
    expect(env.PI_SESSION_ID).toBe("session-123");
    expect(env.PI_SESSION_FILE).toBe("/tmp/session-123.jsonl");
    manager.cleanup();
  });
});

describe("formatStartDetails", () => {
  it("includes matcher details and watch guidance", () => {
    const text = formatStartDetails({
      action: "start",
      process: processInfo,
      notify: {
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
      },
    });

    expect(text).toContain(
      "Continue other work; watch notifications will trigger follow-up.",
    );
    expect(text).toContain('[both] literal turn "ready"');
  });

  it("keeps matcher control characters on one logical line", () => {
    const text = formatStartDetails({
      action: "start",
      process: processInfo,
      notify: {
        logMatches: [
          {
            pattern: 'ERROR\nretry\t"quoted"',
            mode: "regex",
            stream: "stderr",
            repeat: true,
            on: "context",
          },
        ],
      },
    });

    expect(text).toContain(
      '[stderr] regex context (repeat) "ERROR\\nretry\\t\\"quoted\\""',
    );
  });
});
