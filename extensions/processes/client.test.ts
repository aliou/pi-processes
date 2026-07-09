import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { CommandKillPayload } from "../../src/protocol";
import { CHANNELS } from "../../src/protocol";
import type { KillResult, ProcessInfo } from "../../src/types";
import { requestKill } from "./client";

function makeInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
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
    ...overrides,
  };
}

function makeKillResult(id: string): KillResult {
  return {
    ok: true,
    info: { ...makeInfo({ id }), status: "exited", endTime: 2000 },
  };
}

describe("requestKill", () => {
  it("resolves with the async handler's reply, not the no-reply fallback", async () => {
    const events = createEventBus();

    // The kill handler replies on a microtask, mirroring the real
    // COMMAND_KILL listener which awaits manager.kill().
    events.on(CHANNELS.COMMAND_KILL, (payload: unknown) => {
      const p = payload as CommandKillPayload;
      expect(p.id).toBe("proc_1");
      expect(p.signal).toBe("SIGTERM");
      expect(p.timeoutMs).toBe(3000);
      Promise.resolve().then(() => p.reply(makeKillResult("proc_1")));
    });

    const result = await requestKill(events, "proc_1", {
      signal: "SIGTERM",
      timeoutMs: 3000,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.info.id).toBe("proc_1");
  });

  it("resolves with a no-reply error result when no listener answers", async () => {
    const events = createEventBus();
    // No COMMAND_KILL listener is registered (e.g. the core extension is not
    // loaded). The promise must still resolve via the safety timeout.
    const result = await requestKill(events, "proc_1", { timeoutMs: 1 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
      expect(result.info.errorMessage).toBe("No kill handler replied");
    }
  });

  it("passes signal and timeoutMs through to the payload", async () => {
    const events = createEventBus();

    const captured = new Promise<CommandKillPayload>((resolve) => {
      events.on(CHANNELS.COMMAND_KILL, (payload: unknown) => {
        const p = payload as CommandKillPayload;
        Promise.resolve().then(() => p.reply(makeKillResult(p.id)));
        resolve(p);
      });
    });

    await requestKill(events, "proc_9", {
      signal: "SIGKILL",
      timeoutMs: 200,
    });

    const payload = await captured;
    expect(payload.id).toBe("proc_9");
    expect(payload.signal).toBe("SIGKILL");
    expect(payload.timeoutMs).toBe(200);
  });
});
