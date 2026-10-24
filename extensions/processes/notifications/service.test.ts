import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ProcessManager } from "../../../src/manager";
import type { ManagerEvent, ProcessInfo } from "../../../src/types";
import type { ProcessWakeConfig } from "../../../src/wake";
import { flushQueuedMicrotasks } from "../../../tests/utils/async";
import type { ProcessProtocolNotificationPayload } from "../../shared/protocol";
import { CHANNELS } from "../../shared/protocol";

import { createNotificationService } from "./service";

function makeInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "test",
    pid: 1234,
    command: "pnpm test",
    cwd: "/tmp",
    startTime: 1000,
    endTime: 2000,
    status: "exited",
    exitCode: 0,
    success: true,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: "exit",
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

const processes = new Map<string, ProcessInfo>();

interface FakeManagerOptions {
  intentionalStops?: Set<string>;
}

function createFakeManager(options: FakeManagerOptions = {}) {
  const listeners: Array<(event: unknown) => void> = [];
  const wakeConfigs = new Map<string, ProcessWakeConfig>();
  const intentionalStops = options.intentionalStops ?? new Set<string>();

  return {
    onEvent(listener: (event: unknown) => void): () => void {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    emit(event: unknown): void {
      for (const listener of listeners) {
        listener(event);
      }
    },
    get(id: string): ProcessInfo | null {
      return processes.get(id) ?? null;
    },
    registerWakeConfig(id: string, config: ProcessWakeConfig): void {
      wakeConfigs.set(id, config);
    },
    getWakeConfig(id: string): ProcessWakeConfig | null {
      return wakeConfigs.get(id) ?? null;
    },
    markIntentionalStop(id: string): void {
      intentionalStops.add(id);
    },
    consumeIntentionalStop(id: string): boolean {
      return intentionalStops.delete(id);
    },
  };
}

type FakeManager = ReturnType<typeof createFakeManager>;

function createService(manager: FakeManager): {
  events: ReturnType<typeof createEventBus>;
  emitted: ProcessProtocolNotificationPayload[];
  dispose: () => void;
} {
  const events = createEventBus();
  const emitted: ProcessProtocolNotificationPayload[] = [];
  events.on(CHANNELS.NOTIFICATION, (payload: unknown) => {
    emitted.push(payload as ProcessProtocolNotificationPayload);
  });
  const service = createNotificationService({
    events,
    manager: manager as unknown as ProcessManager,
  });
  return { events, emitted, dispose: service.dispose };
}

function emitEvent(manager: FakeManager, event: ManagerEvent): void {
  manager.emit(event);
}

describe("NotificationService", () => {
  it("emits a turn notification for a failed process with default config", async () => {
    const manager = createFakeManager();
    manager.registerWakeConfig("proc_1", {});
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({ success: false, exitCode: 1, endReason: "exit" }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(1);
    expect(service.emitted[0].attention).toBe("turn");
    expect(service.emitted[0].processId).toBe("proc_1");

    service.dispose();
  });

  it("emits a turn notification for a successful process with default config", async () => {
    const manager = createFakeManager();
    manager.registerWakeConfig("proc_1", {});
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({ success: true, exitCode: 0, endReason: "exit" }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(1);
    expect(service.emitted[0].attention).toBe("turn");

    service.dispose();
  });

  it("emits a context notification for an intentional stop despite ignore", async () => {
    const manager = createFakeManager();
    manager.registerWakeConfig("proc_1", { onKilled: "ignore" });
    manager.markIntentionalStop("proc_1");
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({
        status: "killed",
        success: false,
        endReason: "signal",
        exitCode: null,
      }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(1);
    expect(service.emitted[0].attention).toBe("context");
    expect(service.emitted[0].kind).toBe("killed");
    expect(service.emitted[0].processId).toBe("proc_1");

    service.dispose();
  });

  it.each([
    { name: "successful", success: true, exitCode: 0 },
    { name: "failed", success: false, exitCode: 1 },
  ])(
    "emits a context notification for an intentionally stopped $name process",
    async ({ success, exitCode }) => {
      const manager = createFakeManager();
      manager.registerWakeConfig("proc_1", {
        onSuccess: "turn",
        onFailure: "turn",
      });
      manager.markIntentionalStop("proc_1");
      const service = createService(manager);

      emitEvent(manager, {
        type: "process_ended",
        info: makeInfo({ success, exitCode, endReason: "exit" }),
      });
      await flushQueuedMicrotasks();

      expect(service.emitted).toHaveLength(1);
      expect(service.emitted[0].attention).toBe("context");

      service.dispose();
    },
  );

  it("emits a context notification for a killed process with default config when not intentional", async () => {
    const manager = createFakeManager();
    manager.registerWakeConfig("proc_1", {});
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({
        status: "killed",
        success: false,
        endReason: "signal",
        exitCode: null,
      }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(1);
    expect(service.emitted[0].attention).toBe("context");

    service.dispose();
  });

  it("promotes an ignored non-zero exit to context", async () => {
    const manager = createFakeManager();
    manager.registerWakeConfig("proc_1", { onFailure: "ignore" });
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({
        status: "exited",
        success: false,
        exitCode: 1,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(1);
    expect(service.emitted[0].kind).toBe("crash");
    expect(service.emitted[0].attention).toBe("context");

    service.dispose();
  });

  it("suppresses an ignored successful exit", async () => {
    const manager = createFakeManager();
    manager.registerWakeConfig("proc_1", { onSuccess: "ignore" });
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({ id: "proc_1", success: true, exitCode: 0 }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(0);

    service.dispose();
  });

  it("suppresses an ignored external kill", async () => {
    const manager = createFakeManager();
    manager.registerWakeConfig("proc_1", { onKilled: "ignore" });
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({
        status: "killed",
        success: false,
        exitCode: null,
        endReason: "signal",
      }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(0);

    service.dispose();
  });

  it("emits default failure notification for unregistered process with no config", async () => {
    const manager = createFakeManager();
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({
        id: "proc_unknown",
        success: false,
        exitCode: 1,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(1);
    expect(service.emitted[0].attention).toBe("turn");

    service.dispose();
  });

  it("emits turn notification for unregistered successful process", async () => {
    const manager = createFakeManager();
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({
        id: "proc_unknown",
        success: true,
        exitCode: 0,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(1);
    expect(service.emitted[0].attention).toBe("turn");

    service.dispose();
  });

  it("uses custom onSuccess attention from config", async () => {
    const manager = createFakeManager();
    manager.registerWakeConfig("proc_1", { onSuccess: "context" });
    const service = createService(manager);

    emitEvent(manager, {
      type: "process_ended",
      info: makeInfo({ success: true, exitCode: 0, endReason: "exit" }),
    });
    await flushQueuedMicrotasks();

    expect(service.emitted).toHaveLength(1);
    expect(service.emitted[0].attention).toBe("context");

    service.dispose();
  });

  it("handles processes_changed events without emitting notifications", () => {
    const manager = createFakeManager();
    const service = createService(manager);

    emitEvent(manager, { type: "processes_changed" });

    expect(service.emitted).toHaveLength(0);

    service.dispose();
  });

  it("handles process_started event without emitting notification", () => {
    const manager = createFakeManager();
    const service = createService(manager);

    emitEvent(manager, { type: "process_started", info: makeInfo() });

    expect(service.emitted).toHaveLength(0);

    service.dispose();
  });

  describe("watch matches", () => {
    it("emits one log_match notification per match with the matcher attention", () => {
      const manager = createFakeManager();
      processes.set("proc_1", makeInfo({ id: "proc_1", status: "running" }));
      const service = createService(manager);

      emitEvent(manager, {
        type: "process_watch_matched",
        id: "proc_1",
        matches: [
          {
            matcherIndex: 0,
            pattern: "ready",
            mode: "literal",
            stream: "stdout",
            line: "server ready",
            on: "turn",
          },
          {
            matcherIndex: 1,
            pattern: "error",
            mode: "regex",
            stream: "stderr",
            line: "error: boom",
            on: "context",
          },
        ],
      });

      expect(service.emitted).toHaveLength(2);
      expect(service.emitted[0]).toMatchObject({
        kind: "log_match",
        processId: "proc_1",
        processName: "test",
        command: "pnpm test",
        attention: "turn",
        logMatch: {
          pattern: "ready",
          mode: "literal",
          stream: "stdout",
          line: "server ready",
          matcherIndex: 0,
        },
      });
      expect(service.emitted[1].attention).toBe("context");

      processes.delete("proc_1");
      service.dispose();
    });

    it("falls back to the process id and empty command for unknown processes", () => {
      const manager = createFakeManager();
      const service = createService(manager);

      emitEvent(manager, {
        type: "process_watch_matched",
        id: "proc_gone",
        matches: [
          {
            matcherIndex: 0,
            pattern: "ready",
            mode: "literal",
            stream: "stdout",
            line: "server ready",
            on: "context",
          },
        ],
      });

      expect(service.emitted).toHaveLength(1);
      expect(service.emitted[0]).toMatchObject({
        processName: "proc_gone",
        command: "",
      });

      service.dispose();
    });

    it("truncates long matched lines to 160 characters", () => {
      const manager = createFakeManager();
      const service = createService(manager);

      const line = "x".repeat(200);
      emitEvent(manager, {
        type: "process_watch_matched",
        id: "proc_1",
        matches: [
          {
            matcherIndex: 0,
            pattern: "x+",
            mode: "regex",
            stream: "stdout",
            line,
            on: "turn",
          },
        ],
      });

      expect(service.emitted[0].logMatch?.line).toBe(
        `${line.slice(0, 157)}...`,
      );

      service.dispose();
    });
  });

  describe("disposal", () => {
    it("does not emit after dispose()", async () => {
      const manager = createFakeManager();
      manager.registerWakeConfig("proc_1", {});
      const service = createService(manager);

      service.dispose();

      emitEvent(manager, {
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          success: false,
          exitCode: 1,
          endReason: "exit",
        }),
      });
      await flushQueuedMicrotasks();

      emitEvent(manager, {
        type: "process_watch_matched",
        id: "proc_1",
        matches: [
          {
            matcherIndex: 0,
            pattern: "ready",
            mode: "literal",
            stream: "stdout",
            line: "ready",
            on: "turn",
          },
        ],
      });

      expect(service.emitted).toHaveLength(0);
    });

    it("does not emit for events emitted during disposal sequence", async () => {
      const manager = createFakeManager();
      const service = createService(manager);

      service.dispose();

      emitEvent(manager, {
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          success: false,
          exitCode: 1,
          endReason: "exit",
        }),
      });
      await flushQueuedMicrotasks();

      expect(service.emitted).toHaveLength(0);
    });

    it("dispose is idempotent", () => {
      const manager = createFakeManager();
      const service = createService(manager);

      service.dispose();
      service.dispose();

      expect(service.emitted).toHaveLength(0);
    });
  });

  describe("deferred process_ended and config registration race", () => {
    it("downgrades forced failure display to context when onFailure:ignore is registered before microtask", async () => {
      const manager = createFakeManager();
      const service = createService(manager);

      emitEvent(manager, {
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          success: false,
          exitCode: 1,
          endReason: "exit",
        }),
      });

      manager.registerWakeConfig("proc_1", { onFailure: "ignore" });

      await flushQueuedMicrotasks();

      expect(service.emitted).toHaveLength(1);
      expect(service.emitted[0].kind).toBe("crash");
      expect(service.emitted[0].attention).toBe("context");

      service.dispose();
    });

    it("applies onKilled:context registered after emit but before microtask", async () => {
      const manager = createFakeManager();
      const service = createService(manager);

      emitEvent(manager, {
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          status: "killed",
          success: false,
          endReason: "signal",
          exitCode: null,
        }),
      });

      manager.registerWakeConfig("proc_1", { onKilled: "context" });

      await flushQueuedMicrotasks();

      expect(service.emitted).toHaveLength(1);
      expect(service.emitted[0].attention).toBe("context");

      service.dispose();
    });

    it("does not emit if disposed before microtask fires", async () => {
      const manager = createFakeManager();
      manager.registerWakeConfig("proc_1", {});
      const service = createService(manager);

      emitEvent(manager, {
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          success: false,
          exitCode: 1,
          endReason: "exit",
        }),
      });

      service.dispose();

      await flushQueuedMicrotasks();

      expect(service.emitted).toHaveLength(0);
    });
  });
});
