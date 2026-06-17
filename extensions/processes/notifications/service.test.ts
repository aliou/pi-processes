import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ProcessProtocolNotificationPayload } from "../../../src/protocol";
import { CHANNELS } from "../../../src/protocol";
import type { ProcessInfo } from "../../../src/types";
import { flushQueuedMicrotasks } from "../../../tests/utils/async";

import { createNotificationRegistry } from "./registry";
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

function createFakeManager() {
  const listeners: Array<(event: unknown) => void> = [];

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
  };
}

/**
 * Real in-memory event bus with a spy listener on CHANNELS.NOTIFICATION so
 * tests assert on the payloads the service fans out rather than on Pi's
 * sendMessage (now handled by the delivery listener).
 */
function createNotificationSpy(): {
  events: ReturnType<typeof createEventBus>;
  emitted: ProcessProtocolNotificationPayload[];
} {
  const events = createEventBus();
  const emitted: ProcessProtocolNotificationPayload[] = [];
  events.on(CHANNELS.NOTIFICATION, (payload: unknown) => {
    emitted.push(payload as ProcessProtocolNotificationPayload);
  });
  return { events, emitted };
}

describe("NotificationService", () => {
  it("emits a turn notification for a failed process with default config", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", {});

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        success: false,
        exitCode: 1,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(1);
    expect(spy.emitted[0].attention).toBe("turn");
    expect(spy.emitted[0].processId).toBe("proc_1");

    service.dispose();
  });

  it("emits a context notification for a successful process with default config", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", {});

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        success: true,
        exitCode: 0,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(1);
    expect(spy.emitted[0].attention).toBe("context");

    service.dispose();
  });

  it("suppresses killed notification for intentional stop", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onKilled: "ignore" });
    registry.markIntentionalStop("proc_1");

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        status: "killed",
        success: false,
        endReason: "signal",
        exitCode: null,
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(0);

    service.dispose();
  });

  it.each([
    { name: "successful", success: true, exitCode: 0 },
    { name: "failed", success: false, exitCode: 1 },
  ])("suppresses $name exit notification for intentional stop", async ({
    success,
    exitCode,
  }) => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onSuccess: "turn", onFailure: "turn" });
    registry.markIntentionalStop("proc_1");

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        success,
        exitCode,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(0);
    expect(registry.get("proc_1")).toBeNull();

    service.dispose();
  });

  it("does not emit for killed process with default config when not intentional", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    // Default onKilled is "ignore", and killed is not forced display.
    registry.register("proc_1", {});

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        status: "killed",
        success: false,
        endReason: "signal",
        exitCode: null,
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(0);

    service.dispose();
  });

  it("forces emit for crash even when attention is ignore", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onFailure: "ignore" });

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        status: "exited",
        success: false,
        exitCode: 1,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    // Crash forces display: attention becomes "context"
    expect(spy.emitted).toHaveLength(1);
    expect(spy.emitted[0].kind).toBe("crash");
    expect(spy.emitted[0].attention).toBe("context");

    service.dispose();
  });

  it("forces emit for timeout even when attention is ignore", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onFailure: "ignore" });

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        status: "terminate_timeout",
        success: false,
        endReason: "kill_timeout",
        exitCode: null,
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(1);
    expect(spy.emitted[0].kind).toBe("timeout");
    expect(spy.emitted[0].attention).toBe("context");

    service.dispose();
  });

  it("emits log match notification on output changed", () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    processes.set("proc_1", makeInfo({ id: "proc_1" }));
    registry.register("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: [{ type: "stdout", text: "Server ready on port 3000" }],
    });

    expect(spy.emitted).toHaveLength(1);
    expect(spy.emitted[0].kind).toBe("log_match");
    expect(spy.emitted[0].attention).toBe("turn");
    expect(spy.emitted[0].logMatch?.pattern).toBe("ready");

    processes.delete("proc_1");
    service.dispose();
  });

  it("does not emit log match notification when no appended text", () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: undefined,
    });

    expect(spy.emitted).toHaveLength(0);

    service.dispose();
  });

  it("does not emit log match notification when no config registered", () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: [{ type: "stdout", text: "ready" }],
    });

    expect(spy.emitted).toHaveLength(0);

    service.dispose();
  });

  describe("disposal", () => {
    it("does not emit after dispose()", async () => {
      const fakeManager = createFakeManager();
      const spy = createNotificationSpy();
      const registry = createNotificationRegistry();

      registry.register("proc_1", {});

      const service = createNotificationService({
        events: spy.events,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      service.dispose();

      fakeManager.emit({
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          success: false,
          exitCode: 1,
          endReason: "exit",
        }),
      });
      await flushQueuedMicrotasks();

      fakeManager.emit({
        type: "process_output_changed",
        id: "proc_1",
        appendedText: [{ type: "stdout", text: "ready" }],
      });

      expect(spy.emitted).toHaveLength(0);
    });

    it("does not emit for events emitted during disposal sequence", async () => {
      const fakeManager = createFakeManager();
      const spy = createNotificationSpy();
      const registry = createNotificationRegistry();

      registry.register("proc_1", {});

      const service = createNotificationService({
        events: spy.events,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      service.dispose();

      fakeManager.emit({
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          success: false,
          exitCode: 1,
          endReason: "exit",
        }),
      });
      await flushQueuedMicrotasks();

      expect(spy.emitted).toHaveLength(0);
    });

    it("dispose is idempotent", () => {
      const fakeManager = createFakeManager();
      const spy = createNotificationSpy();
      const registry = createNotificationRegistry();

      const service = createNotificationService({
        events: spy.events,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      service.dispose();
      service.dispose();

      expect(spy.emitted).toHaveLength(0);
    });
  });

  it("emits default failure notification for unregistered process with no config", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_unknown",
        success: false,
        exitCode: 1,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    // No config registered, but defaults resolve by kind: failure -> turn
    expect(spy.emitted).toHaveLength(1);
    expect(spy.emitted[0].attention).toBe("turn");

    service.dispose();
  });

  it("emits context notification for unregistered successful process", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_unknown",
        success: true,
        exitCode: 0,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(1);
    expect(spy.emitted[0].attention).toBe("context");

    service.dispose();
  });

  it("unregisters process from registry after process_ended", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", {});

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        success: true,
        exitCode: 0,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(1);
    expect(registry.get("proc_1")).toBeNull();

    service.dispose();
  });

  it("handles processes_changed events without emitting notifications", () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({ type: "processes_changed" });

    expect(spy.emitted).toHaveLength(0);

    service.dispose();
  });

  it("uses custom onSuccess attention from config", async () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onSuccess: "turn" });

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_ended",
      info: makeInfo({
        id: "proc_1",
        success: true,
        exitCode: 0,
        endReason: "exit",
      }),
    });
    await flushQueuedMicrotasks();

    expect(spy.emitted).toHaveLength(1);
    expect(spy.emitted[0].attention).toBe("turn");

    service.dispose();
  });

  it("handles process_started event without emitting notification", () => {
    const fakeManager = createFakeManager();
    const spy = createNotificationSpy();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      events: spy.events,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_started",
      info: makeInfo(),
    });

    expect(spy.emitted).toHaveLength(0);

    service.dispose();
  });

  describe("deferred process_ended and config registration race", () => {
    it("downgrades forced failure display to context when onFailure:ignore is registered before microtask", async () => {
      const fakeManager = createFakeManager();
      const spy = createNotificationSpy();
      const registry = createNotificationRegistry();

      const service = createNotificationService({
        events: spy.events,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      fakeManager.emit({
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          success: false,
          exitCode: 1,
          endReason: "exit",
        }),
      });

      // Config registered after emit but before microtask runs
      registry.register("proc_1", { onFailure: "ignore" });

      await flushQueuedMicrotasks();

      // failure is forced display, so ignore is upgraded to context
      expect(spy.emitted).toHaveLength(1);
      expect(spy.emitted[0].kind).toBe("crash");
      expect(spy.emitted[0].attention).toBe("context");

      service.dispose();
    });

    it("applies onKilled:context registered after emit but before microtask", async () => {
      const fakeManager = createFakeManager();
      const spy = createNotificationSpy();
      const registry = createNotificationRegistry();

      const service = createNotificationService({
        events: spy.events,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      fakeManager.emit({
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          status: "killed",
          success: false,
          endReason: "signal",
          exitCode: null,
        }),
      });

      // killed is not forced display, so onKilled:context takes effect
      registry.register("proc_1", { onKilled: "context" });

      await flushQueuedMicrotasks();

      expect(spy.emitted).toHaveLength(1);
      expect(spy.emitted[0].attention).toBe("context");

      service.dispose();
    });

    it("does not emit if disposed before microtask fires", async () => {
      const fakeManager = createFakeManager();
      const spy = createNotificationSpy();
      const registry = createNotificationRegistry();

      const service = createNotificationService({
        events: spy.events,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      registry.register("proc_1", {});

      fakeManager.emit({
        type: "process_ended",
        info: makeInfo({
          id: "proc_1",
          success: false,
          exitCode: 1,
          endReason: "exit",
        }),
      });

      // Dispose before microtask fires
      service.dispose();

      await flushQueuedMicrotasks();

      expect(spy.emitted).toHaveLength(0);
    });
  });
});
