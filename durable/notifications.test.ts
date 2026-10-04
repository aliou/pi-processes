import type { ConversationId } from "@earendil-works/pi-durable";
import { afterEach, expect, it, vi } from "vitest";
import {
  NotificationDelivery,
  type ProcessNotification,
  terminalAttention,
} from "./notifications";

afterEach(() => vi.useRealTimers());

it("suppresses ignored clean outcomes, promotes failures, and overrides intentional stops", () => {
  expect(
    terminalAttention(
      { status: "exited", success: true },
      { onSuccess: "ignore" },
      false,
    ),
  ).toBeNull();
  expect(
    terminalAttention(
      { status: "killed", success: false },
      { onKilled: "ignore" },
      false,
    ),
  ).toBeNull();
  expect(
    terminalAttention(
      { status: "exited", success: false },
      { onFailure: "ignore" },
      false,
    ),
  ).toBe("context");
  expect(
    terminalAttention(
      { status: "killed", success: false },
      { onKilled: "ignore" },
      true,
    ),
  ).toBe("context");
  expect(
    terminalAttention({ status: "exited", success: false }, {}, false),
  ).toBe("turn");
});

it("rate-limits per conversation, addresses summaries, and releases delivery timers", () => {
  vi.useFakeTimers();
  const sent: ProcessNotification[] = [];
  const delivery = new NotificationDelivery((note) => sent.push(note));
  const match: ProcessNotification = {
    conversationId: 1 as ConversationId,
    taskId: null,
    processId: "opaque-id",
    kind: "log_match",
    attention: "turn",
    summary: "ready",
  };
  for (let index = 0; index < 21; index++) delivery.deliver(match);
  delivery.deliver({ ...match, conversationId: 2 as ConversationId });
  expect(sent).toHaveLength(21);
  vi.advanceTimersByTime(60_000);
  expect(sent.at(-1)).toMatchObject({
    conversationId: match.conversationId,
    kind: "log_match_suppressed",
    attention: "context",
    taskId: null,
  });
  delivery.deliver(match);
  expect(vi.getTimerCount()).toBe(1);
  delivery.dispose();
  expect(vi.getTimerCount()).toBe(0);
  delivery.deliver(match);
  expect(sent).toHaveLength(23);
});
