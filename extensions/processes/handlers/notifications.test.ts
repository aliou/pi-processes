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
  return { sendMessage, on: () => () => {} } as never;
}

function piWithLifecycleHandlers(sendMessage: ReturnType<typeof vi.fn>) {
  const handlers = new Map<string, (event: never, ctx: never) => unknown>();
  const isIdle = vi.fn((): boolean => true);
  const ctx = { isIdle };
  const pi = {
    sendMessage,
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      handlers.set(event, handler as (event: never, ctx: never) => unknown);
      return () => {};
    },
  } as never;
  return {
    pi,
    isIdle,
    fire: (event: string) =>
      (
        handlers.get(event) as
          | ((event: unknown, ctx: unknown) => unknown)
          | undefined
      )?.({}, ctx),
  };
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

  it("maps context attention to a persisted non-turn message", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    registerNotificationDelivery(events, piWithSendMessage(sendMessage));

    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "context" }));

    const [, options] = sendMessage.mock.calls[0];
    expect(options.triggerTurn).toBe(false);
    expect(options.deliverAs).toBeUndefined();
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
    expect(options).toEqual({ triggerTurn: false });

    dispose();
    vi.useRealTimers();
  });

  it("holds notifications during compaction and delivers them in order when it succeeds", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    const { pi, fire } = piWithLifecycleHandlers(sendMessage);
    const dispose = registerNotificationDelivery(events, pi);

    fire("session_before_compact");
    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "turn" }));
    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "context" }));
    expect(sendMessage).not.toHaveBeenCalled();

    fire("session_compact");
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const [firstMessage, firstOptions] = sendMessage.mock.calls[0];
    expect(firstMessage.details.attention).toBe("turn");
    expect(firstOptions).toEqual({ triggerTurn: true, deliverAs: "steer" });
    const [secondMessage, secondOptions] = sendMessage.mock.calls[1];
    expect(secondMessage.details.attention).toBe("context");
    expect(secondOptions).toEqual({ triggerTurn: false });

    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "turn" }));
    expect(sendMessage).toHaveBeenCalledTimes(3);
    dispose();
  });

  it("delivers held notifications when compaction fails or is aborted", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    const { pi, fire } = piWithLifecycleHandlers(sendMessage);
    const dispose = registerNotificationDelivery(events, pi);

    fire("session_before_compact");
    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "turn" }));

    fire("session_compact_failed");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [, options] = sendMessage.mock.calls[0];
    expect(options).toEqual({ triggerTurn: true, deliverAs: "steer" });

    fire("session_before_compact");
    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "turn" }));
    fire("session_compact_failed");
    expect(sendMessage).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("keeps log-match rate limiting for notifications that arrive during compaction", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const events = createEventBus();
    const sendMessage = vi.fn();
    const { pi, fire } = piWithLifecycleHandlers(sendMessage);
    const dispose = registerNotificationDelivery(events, pi);

    fire("session_before_compact");
    for (let index = 0; index < 25; index++) {
      events.emit(
        CHANNELS.NOTIFICATION,
        makePayload({ kind: "log_match", attention: "turn" }),
      );
    }
    expect(sendMessage).not.toHaveBeenCalled();

    fire("session_compact");
    expect(sendMessage).toHaveBeenCalledTimes(20);

    vi.advanceTimersByTime(60_000);
    expect(sendMessage).toHaveBeenCalledTimes(21);
    const [summary] = sendMessage.mock.calls.at(-1) ?? [];
    expect(summary.details).toEqual(
      expect.objectContaining({
        kind: "log_match_suppressed",
        summary: expect.stringContaining("Suppressed 5"),
      }),
    );

    dispose();
    vi.useRealTimers();
  });

  it("holds the timer-driven suppressed summary during compaction and delivers it when compaction ends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const events = createEventBus();
    const sendMessage = vi.fn();
    const { pi, fire } = piWithLifecycleHandlers(sendMessage);
    const dispose = registerNotificationDelivery(events, pi);

    fire("session_before_compact");
    for (let index = 0; index < 25; index++) {
      events.emit(
        CHANNELS.NOTIFICATION,
        makePayload({ kind: "log_match", attention: "turn" }),
      );
    }

    vi.advanceTimersByTime(60_000);
    expect(sendMessage).not.toHaveBeenCalled();

    fire("session_compact");
    expect(sendMessage).toHaveBeenCalledTimes(21);
    const [summary, options] = sendMessage.mock.calls.at(-1) ?? [];
    expect(summary.details).toEqual(
      expect.objectContaining({
        kind: "log_match_suppressed",
        summary: expect.stringContaining("Suppressed 5"),
        attention: "context",
      }),
    );
    expect(options).toEqual({ triggerTurn: false });

    dispose();
    vi.useRealTimers();
  });

  it("records the live isIdle observation at send time", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    const { pi, isIdle, fire } = piWithLifecycleHandlers(sendMessage);
    const dispose = registerNotificationDelivery(events, pi);

    fire("session_start");
    isIdle.mockReturnValueOnce(true).mockReturnValueOnce(false);
    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "turn" }));
    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "context" }));
    expect(sendMessage.mock.calls[0][0].details.sessionIdle).toBe(true);
    expect(sendMessage.mock.calls[1][0].details.sessionIdle).toBe(false);
    expect(isIdle).toHaveBeenCalledTimes(2);

    dispose();
  });

  it("records the isIdle observation for notifications flushed after compaction", () => {
    const events = createEventBus();
    const sendMessage = vi.fn();
    const { pi, isIdle, fire } = piWithLifecycleHandlers(sendMessage);
    const dispose = registerNotificationDelivery(events, pi);

    fire("session_start");
    fire("session_before_compact");
    events.emit(CHANNELS.NOTIFICATION, makePayload({ attention: "turn" }));
    expect(sendMessage).not.toHaveBeenCalled();

    isIdle.mockReturnValue(false);
    fire("session_compact");
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0].details.sessionIdle).toBe(false);

    dispose();
  });
});
