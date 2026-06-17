import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { ProcessProtocolNotificationPayload } from "../../../src/protocol";
import { CHANNELS } from "../../../src/protocol";
import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "../constants";
import { registerNotificationDelivery } from "./notifications";

function makePayload(
  overrides: Partial<ProcessProtocolNotificationPayload> = {},
): ProcessProtocolNotificationPayload {
  return {
    kind: "failure",
    processId: "proc_1",
    processName: "dev",
    command: "pnpm dev",
    timestamp: 123,
    summary: "Process failed.",
    status: "exited",
    exitCode: 1,
    endReason: "exit",
    signal: null,
    attention: "turn",
    ...overrides,
  };
}

function piWithSendMessage(sendMessage: ReturnType<typeof vi.fn>) {
  return { sendMessage } as never;
}

describe("registerNotificationDelivery", () => {
  it("sends a displayed custom message with attention-derived options", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    registerNotificationDelivery(events, piWithSendMessage(sendMessage));

    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "turn" }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [message, options] = sendMessage.mock.calls[0];
    expect(message.customType).toBe(MESSAGE_TYPE_PROCESS_NOTIFICATION);
    expect(message.display).toBe(true);
    expect(message.details.attention).toBe("turn");
    expect(options.triggerTurn).toBe(true);
    expect(options.deliverAs).toBe("steer");
  });

  it("maps context attention to a non-turn steer message", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    registerNotificationDelivery(events, piWithSendMessage(sendMessage));

    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "context" }));

    const [, options] = sendMessage.mock.calls[0];
    expect(options.triggerTurn).toBe(false);
    expect(options.deliverAs).toBe("steer");
  });

  it("ignores malformed payloads", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    registerNotificationDelivery(events, piWithSendMessage(sendMessage));

    events.emit(CHANNELS.NOTIFICATION, null);
    events.emit(CHANNELS.NOTIFICATION, {});
    events.emit(CHANNELS.NOTIFICATION, { kind: "success" });
    events.emit(CHANNELS.NOTIFICATION, { ...makePayload(), attention: 5 });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stops delivering after the disposer is called", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    const dispose = registerNotificationDelivery(
      events,
      piWithSendMessage(sendMessage),
    );

    dispose();
    events.emit(CHANNELS.NOTIFICATION, makePayload());

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
