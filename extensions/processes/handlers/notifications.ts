import type { EventBus, ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  CHANNELS,
  type ProcessProtocolNotificationPayload,
} from "../../../src/protocol";
import { isRecord } from "../../../src/utils/is-record";
import {
  attentionToSendOptions,
  sendProcessNotificationMessage,
} from "../notification-sender";

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
  return events.on(CHANNELS.NOTIFICATION, (payload: unknown) => {
    if (!isNotificationPayload(payload)) return;
    const options = attentionToSendOptions(payload.attention);
    sendProcessNotificationMessage(pi, payload, options);
  });
}

function isNotificationPayload(
  payload: unknown,
): payload is ProcessProtocolNotificationPayload {
  if (!isRecord(payload)) return false;
  if (typeof payload.kind !== "string") return false;
  if (typeof payload.processId !== "string") return false;
  if (typeof payload.processName !== "string") return false;
  if (typeof payload.command !== "string") return false;
  if (typeof payload.timestamp !== "number") return false;
  if (typeof payload.summary !== "string") return false;
  if (typeof payload.attention !== "string") return false;
  return true;
}
