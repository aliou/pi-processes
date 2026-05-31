import { describe, expect, it, vi } from "vitest";

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

const processes = new Map<string, ProcessInfo>();

function createFakePi() {
  return {
    sendMessage: vi.fn(),
  };
}

describe("NotificationService", () => {
  it("sends a turn notification for a failed process with default config", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    registry.register("proc_1", {});

    const service = createNotificationService({
      pi: fakePi as never,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    const info = makeInfo({
      id: "proc_1",
      success: false,
      exitCode: 1,
      endReason: "exit",
    });

    fakeManager.emit({ type: "process_ended", info });
    await flushQueuedMicrotasks();

    expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = fakePi.sendMessage.mock.calls[0];
    expect(message.customType).toBe("ad-process:notification");
    expect(message.display).toBe(true);
    expect(options.triggerTurn).toBe(true);
    expect(options.deliverAs).toBe("steer");

    service.dispose();
  });

  it("sends a context notification for a successful process with default config", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    registry.register("proc_1", {});

    const service = createNotificationService({
      pi: fakePi as never,
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

    expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    const [, options] = fakePi.sendMessage.mock.calls[0];
    expect(options.triggerTurn).toBe(false);
    expect(options.deliverAs).toBe("steer");

    service.dispose();
  });

  it("suppresses killed notification for intentional stop", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onKilled: "ignore" });
    registry.markIntentionalStop("proc_1");

    const service = createNotificationService({
      pi: fakePi as never,
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

    expect(fakePi.sendMessage).not.toHaveBeenCalled();

    service.dispose();
  });

  it("sends notification for killed process when not intentional", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    // Default onKilled is "ignore", but killed is not forced display.
    // So with default config and non-intentional kill, no message is sent.
    registry.register("proc_1", {});

    const service = createNotificationService({
      pi: fakePi as never,
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

    // killed with ignore attention and not forced display = no message
    expect(fakePi.sendMessage).not.toHaveBeenCalled();

    service.dispose();
  });

  it("forces display for crash even when attention is ignore", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onFailure: "ignore" });

    const service = createNotificationService({
      pi: fakePi as never,
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
    expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = fakePi.sendMessage.mock.calls[0];
    expect(message.display).toBe(true);
    expect(options.triggerTurn).toBe(false);
    expect(options.deliverAs).toBe("steer");
    expect(message.details.kind).toBe("crash");

    service.dispose();
  });

  it("forces display for timeout even when attention is ignore", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onFailure: "ignore" });

    const service = createNotificationService({
      pi: fakePi as never,
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

    expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    const [message] = fakePi.sendMessage.mock.calls[0];
    expect(message.display).toBe(true);
    expect(message.details.kind).toBe("timeout");

    service.dispose();
  });

  it("sends log match notification on output changed", () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    processes.set("proc_1", makeInfo({ id: "proc_1" }));
    registry.register("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    const service = createNotificationService({
      pi: fakePi as never,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: [{ type: "stdout", text: "Server ready on port 3000" }],
    });

    expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = fakePi.sendMessage.mock.calls[0];
    expect(message.details.kind).toBe("log_match");
    expect(options.triggerTurn).toBe(true);
    expect(options.deliverAs).toBe("steer");

    processes.delete("proc_1");
    service.dispose();
  });

  it("does not send log match notification when no appended text", () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    registry.register("proc_1", {
      logMatches: [{ pattern: "ready" }],
    });

    const service = createNotificationService({
      pi: fakePi as never,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: undefined,
    });

    expect(fakePi.sendMessage).not.toHaveBeenCalled();

    service.dispose();
  });

  it("does not send log match notification when no config registered", () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      pi: fakePi as never,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_output_changed",
      id: "proc_1",
      appendedText: [{ type: "stdout", text: "ready" }],
    });

    expect(fakePi.sendMessage).not.toHaveBeenCalled();

    service.dispose();
  });

  describe("disposal", () => {
    it("does not send after dispose()", async () => {
      const fakeManager = createFakeManager();
      const fakePi = createFakePi();
      const registry = createNotificationRegistry();

      registry.register("proc_1", {});

      const service = createNotificationService({
        pi: fakePi as never,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      service.dispose();

      // Emit events after disposal
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

      expect(fakePi.sendMessage).not.toHaveBeenCalled();
    });

    it("does not send for events emitted during disposal sequence", async () => {
      const fakeManager = createFakeManager();
      const fakePi = createFakePi();
      const registry = createNotificationRegistry();

      registry.register("proc_1", {});

      const service = createNotificationService({
        pi: fakePi as never,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      // Dispose and then emit
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

      expect(fakePi.sendMessage).not.toHaveBeenCalled();
    });

    it("dispose is idempotent", () => {
      const fakeManager = createFakeManager();
      const fakePi = createFakePi();
      const registry = createNotificationRegistry();

      const service = createNotificationService({
        pi: fakePi as never,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      service.dispose();
      service.dispose();

      // No errors thrown
      expect(fakePi.sendMessage).not.toHaveBeenCalled();
    });
  });

  it("sends default failure notification for unregistered process with no config", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      pi: fakePi as never,
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
    expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    const [, options] = fakePi.sendMessage.mock.calls[0];
    expect(options.triggerTurn).toBe(true);
    expect(options.deliverAs).toBe("steer");

    service.dispose();
  });

  it("sends context notification for unregistered successful process", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      pi: fakePi as never,
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

    // No config registered, defaults resolve by kind: success -> context
    expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    const [, options] = fakePi.sendMessage.mock.calls[0];
    expect(options.triggerTurn).toBe(false);
    expect(options.deliverAs).toBe("steer");

    service.dispose();
  });

  it("unregisters process from registry after process_ended", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    registry.register("proc_1", {});

    const service = createNotificationService({
      pi: fakePi as never,
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

    expect(registry.get("proc_1")).toBeNull();

    service.dispose();
  });

  it("handles processes_changed events without sending notifications", () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      pi: fakePi as never,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({ type: "processes_changed" });

    expect(fakePi.sendMessage).not.toHaveBeenCalled();

    service.dispose();
  });

  it("uses custom onSuccess attention from config", async () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    registry.register("proc_1", { onSuccess: "turn" });

    const service = createNotificationService({
      pi: fakePi as never,
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

    expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
    const [, options] = fakePi.sendMessage.mock.calls[0];
    expect(options.triggerTurn).toBe(true);
    expect(options.deliverAs).toBe("steer");

    service.dispose();
  });

  it("handles process_started event without sending notification", () => {
    const fakeManager = createFakeManager();
    const fakePi = createFakePi();
    const registry = createNotificationRegistry();

    const service = createNotificationService({
      pi: fakePi as never,
      manager: fakeManager as never,
      registry,
      getProcess: (id) => processes.get(id) ?? null,
    });

    fakeManager.emit({
      type: "process_started",
      info: makeInfo(),
    });

    expect(fakePi.sendMessage).not.toHaveBeenCalled();

    service.dispose();
  });

  describe("deferred process_ended and config registration race", () => {
    it("downgrades forced failure display to context when onFailure:ignore is registered before microtask", async () => {
      const fakeManager = createFakeManager();
      const fakePi = createFakePi();
      const registry = createNotificationRegistry();

      const service = createNotificationService({
        pi: fakePi as never,
        manager: fakeManager as never,
        registry,
        getProcess: (id) => processes.get(id) ?? null,
      });

      // Simulate: manager.start() emits process_ended synchronously
      // (e.g. missing_pid), then executeStart() registers config.
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
      expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
      const [message, options] = fakePi.sendMessage.mock.calls[0];
      expect(message.display).toBe(true);
      expect(options.triggerTurn).toBe(false);
      expect(options.deliverAs).toBe("steer");

      service.dispose();
    });

    it("applies onKilled:context registered after emit but before microtask", async () => {
      const fakeManager = createFakeManager();
      const fakePi = createFakePi();
      const registry = createNotificationRegistry();

      const service = createNotificationService({
        pi: fakePi as never,
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

      expect(fakePi.sendMessage).toHaveBeenCalledTimes(1);
      const [, options] = fakePi.sendMessage.mock.calls[0];
      expect(options.triggerTurn).toBe(false);
      expect(options.deliverAs).toBe("steer");

      service.dispose();
    });

    it("does not send if disposed before microtask fires", async () => {
      const fakeManager = createFakeManager();
      const fakePi = createFakePi();
      const registry = createNotificationRegistry();

      const service = createNotificationService({
        pi: fakePi as never,
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

      expect(fakePi.sendMessage).not.toHaveBeenCalled();
    });
  });
});
