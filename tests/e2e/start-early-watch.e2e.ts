import {
  createEventBus,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expect } from "vitest";

import { createNotificationRegistry } from "../../extensions/processes/notifications/registry";
import { createNotificationService } from "../../extensions/processes/notifications/service";
import { executeStart } from "../../extensions/processes/tools/start";
import type { ProcessProtocolNotificationPayload } from "../../extensions/shared/protocol";
import { CHANNELS } from "../../extensions/shared/protocol";
import { ProcessManager } from "../../src/manager";
import { flushQueuedMacrotasks } from "../utils/async";
import { test } from "./fixtures";

function createContext(cwd: string): ExtensionContext {
  return {
    cwd,
    sessionManager: {
      getSessionId: () => "session-123",
      getSessionFile: () => "/tmp/session-123.jsonl",
    },
  } as ExtensionContext;
}

function createNotifications(manager: ProcessManager) {
  const events = createEventBus();
  const emitted: ProcessProtocolNotificationPayload[] = [];
  events.on(CHANNELS.NOTIFICATION, (payload: unknown) => {
    emitted.push(payload as ProcessProtocolNotificationPayload);
  });
  const registry = createNotificationRegistry();
  const service = createNotificationService({
    events,
    manager,
    registry,
    getProcess: (id) => manager.get(id),
  });
  return { emitted, registry, service };
}

const notify = { logMatches: [{ pattern: "ready" }] };

test("matches early output from a running process exactly once", async ({
  cwd,
}) => {
  using manager = new ProcessManager();
  const { emitted, registry, service } = createNotifications(manager);

  try {
    const details = await executeStart(
      {
        action: "start",
        name: "early-running",
        command: "printf 'ready\\n'; sleep 60",
        notify,
      },
      manager,
      createContext(cwd),
      registry,
    );

    expect(details.process.status).toBe("running");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(
      expect.objectContaining({
        kind: "log_match",
        processId: details.process.id,
        logMatch: expect.objectContaining({
          pattern: "ready",
          line: "ready",
          stream: "stdout",
        }),
      }),
    );
  } finally {
    service.dispose();
  }
});

test("matches early output before an immediate clean exit", async ({ cwd }) => {
  using manager = new ProcessManager();
  const { emitted, registry, service } = createNotifications(manager);

  try {
    const details = await executeStart(
      {
        action: "start",
        name: "early-success",
        command: "printf 'ready\\n'",
        notify,
      },
      manager,
      createContext(cwd),
      registry,
    );

    expect(details.process).toEqual(
      expect.objectContaining({ status: "exited", exitCode: 0, success: true }),
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.kind).toBe("log_match");

    await flushQueuedMacrotasks();

    expect(emitted).toHaveLength(1);
  } finally {
    service.dispose();
  }
});

test("matches early output before an immediate failure", async ({ cwd }) => {
  using manager = new ProcessManager();
  const { emitted, registry, service } = createNotifications(manager);

  try {
    await expect(
      executeStart(
        {
          action: "start",
          name: "early-failure",
          command: "printf 'ready\\n'; exit 7",
          notify,
        },
        manager,
        createContext(cwd),
        registry,
      ),
    ).rejects.toThrow(/exited immediately: exit code 7/);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.kind).toBe("log_match");

    await flushQueuedMacrotasks();

    expect(emitted).toHaveLength(1);
  } finally {
    service.dispose();
  }
});
