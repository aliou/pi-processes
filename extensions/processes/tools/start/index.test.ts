import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import type { NotificationRegistry } from "../../notifications/registry";
import { createNotificationRegistry } from "../../notifications/registry";
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

function createFakeRegistry(): NotificationRegistry {
  return createNotificationRegistry();
}

function createStartMock(info: ProcessInfo = processInfo) {
  return vi.fn(
    async (
      _name: string,
      _command: string,
      _cwd: string,
      _env?: NodeJS.ProcessEnv,
      onSpawn?: (process: ProcessInfo) => void,
    ) => {
      onSpawn?.(info);
      return info;
    },
  );
}

describe("executeStart", () => {
  it("validates notify before starting the process", async () => {
    const start = createStartMock();
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    await expect(
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
    ).rejects.toThrow(/not a valid regular expression/);

    expect(start).not.toHaveBeenCalled();
  });

  it("returns normalized notify config in start details", async () => {
    const start = createStartMock();
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    const details = await executeStart(
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

    expect(start).toHaveBeenCalledWith(
      "dev",
      "pnpm dev",
      "/repo",
      expect.anything(),
      expect.any(Function),
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
  });

  it("registers notify config with the notification registry during start", async () => {
    const start = createStartMock();
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    const notify = { logMatches: [{ pattern: "ready" }] };
    await executeStart(
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
    expect(registered?.onSuccess).toBe("turn");
    expect(registered?.onFailure).toBe("turn");
    expect(registered?.onKilled).toBe("context");
    expect(registered?.logMatches).toHaveLength(1);
    expect(registered?.logMatches?.[0]?.pattern).toBe("ready");
  });

  it("does not register notify config when validation fails", async () => {
    const start = createStartMock();
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    await expect(
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
    ).rejects.toThrow(/not a valid regular expression/);

    expect(start).not.toHaveBeenCalled();
    expect(registry.get("proc_1")).toBeNull();
  });

  it("starts with the explicit cwd when provided", async () => {
    const start = createStartMock({ ...processInfo, cwd: "/explicit" });
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    const details = await executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
        cwd: "/explicit",
      },
      manager,
      ctx,
      registry,
    );

    expect(start).toHaveBeenCalledWith(
      "dev",
      "pnpm dev",
      "/explicit",
      expect.anything(),
      expect.any(Function),
    );
    expect(details.process.cwd).toBe("/explicit");
  });

  it("falls back to ctx.cwd when cwd is not provided", async () => {
    const start = createStartMock({ ...processInfo, cwd: "/repo" });
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    await executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
      },
      manager,
      ctx,
      registry,
    );

    expect(start).toHaveBeenCalledWith(
      "dev",
      "pnpm dev",
      "/repo",
      expect.anything(),
      expect.any(Function),
    );
  });

  it("starts with PI_* session variables injected into the child env", async () => {
    const start = createStartMock();
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    await executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
      },
      manager,
      ctx,
      registry,
    );

    const env = start.mock.calls[0]?.[3] as NodeJS.ProcessEnv;
    expect(env.PI_SESSION_ID).toBe("session-123");
    expect(env.PI_SESSION_FILE).toBe("/tmp/session-123.jsonl");
  });

  it("returns a successfully exited process in start details", async () => {
    const exited: ProcessInfo = {
      ...processInfo,
      status: "exited",
      endTime: 1100,
      exitCode: 0,
      success: true,
      endReason: "exit",
    };
    const start = createStartMock(exited);
    const manager = { start } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    const details = await executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
      },
      manager,
      ctx,
      registry,
    );

    expect(details.process.status).toBe("exited");
    expect(details.process.exitCode).toBe(0);
    expect(registry.get("proc_1")).not.toBeNull();
    expect(registry.consumeStartReported("proc_1")).toBe(true);
  });

  it("fails the tool call when the process exits immediately with failure", async () => {
    const exited: ProcessInfo = {
      ...processInfo,
      status: "exited",
      endTime: 1100,
      exitCode: 1,
      success: false,
      endReason: "exit",
    };
    const manager = {
      start: createStartMock(exited),
    } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    await expect(
      executeStart(
        {
          action: "start",
          name: "dev",
          command: "exit 1",
        },
        manager,
        ctx,
        registry,
      ),
    ).rejects.toThrow("Process dev (proc_1) exited immediately: exit code 1.");

    expect(registry.consumeStartReported("proc_1")).toBe(true);
  });

  it("fails the tool call with the spawn error message", async () => {
    const exited: ProcessInfo = {
      ...processInfo,
      status: "exited",
      endTime: 1050,
      exitCode: -1,
      success: false,
      endReason: "spawn_error",
      errorMessage: "spawn /bin/bash ENOENT",
    };
    const manager = {
      start: createStartMock(exited),
    } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    await expect(
      executeStart(
        {
          action: "start",
          name: "dev",
          command: "missing",
        },
        manager,
        ctx,
        registry,
      ),
    ).rejects.toThrow(
      "Process dev (proc_1) exited immediately: failed to spawn (spawn /bin/bash ENOENT).",
    );
  });

  it("fails the tool call with the signal for an immediate kill", async () => {
    const exited: ProcessInfo = {
      ...processInfo,
      status: "killed",
      endTime: 1080,
      success: false,
      endReason: "signal",
      signal: {
        name: "SIGTERM",
        number: 15,
        description: "termination request",
      },
    };
    const manager = {
      start: createStartMock(exited),
    } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    await expect(
      executeStart(
        {
          action: "start",
          name: "dev",
          command: "sleep 60",
        },
        manager,
        ctx,
        registry,
      ),
    ).rejects.toThrow(
      "Process dev (proc_1) exited immediately: killed by SIGTERM.",
    );
  });

  it("does not mark a running start as start-reported", async () => {
    const manager = {
      start: createStartMock(),
    } as unknown as ProcessManager;
    const registry = createFakeRegistry();

    await executeStart(
      {
        action: "start",
        name: "dev",
        command: "pnpm dev",
      },
      manager,
      ctx,
      registry,
    );

    expect(registry.consumeStartReported("proc_1")).toBe(false);
  });
});

describe("formatStartDetails", () => {
  it("describes an immediate clean exit with the exit code", () => {
    const text = formatStartDetails({
      action: "start",
      process: {
        ...processInfo,
        status: "exited",
        endTime: 1100,
        exitCode: 0,
        success: true,
        endReason: "exit",
      },
      notify: {},
    });

    expect(text).toBe("Process dev (proc_1) exited immediately: exit code 0.");
  });

  it("keeps the started wording for a running process", () => {
    const text = formatStartDetails({
      action: "start",
      process: processInfo,
      notify: {},
    });

    expect(text).toBe("Started process dev (proc_1) with pid 123.");
  });

  it("includes matcher details and watch guidance", async () => {
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

  it("keeps matcher control characters on one logical line", async () => {
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
