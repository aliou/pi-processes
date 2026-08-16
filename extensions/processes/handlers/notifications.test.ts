import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { ProcessProtocolNotificationPayload } from "../../shared/protocol";
import { CHANNELS } from "../../shared/protocol";
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

  it("caps log-match delivery, summarizes suppression, and exempts lifecycle events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const events = createEventBus();
    const sendMessage = vi.fn();
    const dispose = registerNotificationDelivery(
      events,
      piWithSendMessage(sendMessage),
    );

    for (let index = 0; index < 30; index++) {
      events.emit(
        CHANNELS.NOTIFICATION,
        makePayload({ kind: "log_match", attention: "turn" }),
      );
    }
    expect(sendMessage).toHaveBeenCalledTimes(20);

    events.emit(CHANNELS.NOTIFICATION, makePayload({ kind: "crash" }));
    expect(sendMessage).toHaveBeenCalledTimes(21);
    expect(sendMessage.mock.calls.at(-1)?.[0].details.kind).toBe("crash");

    vi.advanceTimersByTime(60_000);
    expect(sendMessage).toHaveBeenCalledTimes(22);
    const [summary, options] = sendMessage.mock.calls.at(-1) ?? [];
    expect(summary.details).toEqual(
      expect.objectContaining({
        kind: "log_match_suppressed",
        summary: expect.stringContaining("Suppressed 10"),
        attention: "context",
      }),
    );
    expect(options).toEqual({ triggerTurn: false, deliverAs: "steer" });

    dispose();
    vi.useRealTimers();
  });
});
