import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "./constants";
import { buildProcessNotificationContent } from "./notifications/render-content";
import type {
  Attention,
  ProcessNotificationDetails,
} from "./notifications/types";

export interface ProcessNotificationSendOptions {
  triggerTurn: boolean;
  deliverAs?: "steer";
}

/**
 * Maps a notification attention level to Pi send-message options.
 *
 * `turn` wakes or steers the agent. Context-level notifications persist
 * immediately as displayed custom messages without triggering a turn. While a
 * turn is running, pi holds them and appends once every tool result of the
 * turn is in (pi 0.84.4+ #8537), so they never split a tool call from its
 * result. On older pi this option shape is unsafe: ≤0.84.1 steers the active
 * run, and 0.84.2–0.84.3 appends mid-run and breaks provider ordering. This
 * package targets pi 0.87.0; on older pi, widen the `deliverAs` type and send
 * `"nextTurn"` instead (deferred to the next user prompt on every version).
 */
export function attentionToSendOptions(
  attention: Attention,
): ProcessNotificationSendOptions {
  switch (attention) {
    case "turn":
      return { triggerTurn: true, deliverAs: "steer" };
    case "context":
      return { triggerTurn: false };
    case "ignore":
      return { triggerTurn: false };
  }
}

export function sendProcessNotificationMessage(
  pi: ExtensionAPI,
  details: ProcessNotificationDetails,
  options: ProcessNotificationSendOptions,
): void {
  pi.sendMessage<ProcessNotificationDetails>(
    {
      customType: MESSAGE_TYPE_PROCESS_NOTIFICATION,
      content: buildProcessNotificationContent(details),
      display: true,
      details,
    },
    options,
  );
}
