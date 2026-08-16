import type { EventBus, ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  CHANNELS,
  type ProcessProtocolNotificationPayload,
} from "../../../src/protocol";
import {
  attentionToSendOptions,
  sendProcessNotificationMessage,
} from "../notification-sender";

const NOTIFICATION_WINDOW_MS = 60_000;
const MAX_LOG_MATCH_NOTIFICATIONS_PER_WINDOW = 20;

/**
 * Delivers notification events emitted on {@link CHANNELS.NOTIFICATION} to Pi as
 * persisted custom messages. This is the core side of the notification fanout:
 * the NotificationService emits language-neutral payloads, and this listener
 * converts each payload into a displayed `ad-process:notification` message with
 * the attention-derived send options. UI extensions observe the same channel
 * for display concerns (e.g. log-match highlighting) without importing this
 * module.
 *
 * Returns a disposer that removes the listener; it must be called on
 * `session_shutdown` before the manager is killed.
 */
export function registerNotificationDelivery(
  events: EventBus,
  pi: ExtensionAPI,
): () => void {
  let windowStart: number | null = null;
  let sentInWindow = 0;
  let suppressed = 0;
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearSummaryTimer = () => {
    if (!summaryTimer) return;
    clearTimeout(summaryTimer);
    summaryTimer = null;
  };

  const resetWindow = (): number => {
    clearSummaryTimer();
    const count = suppressed;
    windowStart = null;
    sentInWindow = 0;
    suppressed = 0;
    return count;
  };

  const sendSuppressedSummary = (count: number) => {
    if (count === 0) return;
    const details: ProcessProtocolNotificationPayload = {
      kind: "log_match_suppressed",
      processId: "*",
      processName: "log watches",
      command: "",
      timestamp: Date.now(),
      summary: `Suppressed ${count} log-match notifications because output was too fast.`,
      attention: "context",
    };
    sendProcessNotificationMessage(
      pi,
      details,
      attentionToSendOptions(details.attention),
    );
  };

  const flushSuppressedSummary = () => {
    const count = resetWindow();
    sendSuppressedSummary(count);
  };

  const startWindow = (now: number) => {
    windowStart = now;
    sentInWindow = 0;
    suppressed = 0;
    clearSummaryTimer();
    summaryTimer = setTimeout(flushSuppressedSummary, NOTIFICATION_WINDOW_MS);
    summaryTimer.unref?.();
  };

  const disposeListener = events.on(
    CHANNELS.NOTIFICATION,
    (rawPayload: unknown) => {
      const payload = rawPayload as ProcessProtocolNotificationPayload;

      if (payload.kind === "log_match") {
        const now = performance.now();
        if (
          windowStart === null ||
          now - windowStart >= NOTIFICATION_WINDOW_MS
        ) {
          const previousSuppressed = windowStart === null ? 0 : resetWindow();
          startWindow(now);
          sendSuppressedSummary(previousSuppressed);
        }
        if (sentInWindow >= MAX_LOG_MATCH_NOTIFICATIONS_PER_WINDOW) {
          suppressed++;
          return;
        }
        sentInWindow++;
      }

      const options = attentionToSendOptions(payload.attention);
      sendProcessNotificationMessage(pi, payload, options);
    },
  );

  return () => {
    disposeListener();
    resetWindow();
  };
}
