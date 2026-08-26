import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "./constants";
import { buildProcessNotificationContent } from "./notifications/render-content";
import type {
  Attention,
  ProcessNotificationDetails,
} from "./notifications/types";

export interface ProcessNotificationSendOptions {
  triggerTurn: boolean;
  deliverAs: "steer" | "followUp" | "nextTurn";
}

/**
 * Maps a notification attention level to Pi send-message options.
 *
 * `turn` wakes or steers the agent. Other emitted notifications wait for the
 * next user prompt so they cannot split a tool call from its result.
 */
export function attentionToSendOptions(
  attention: Attention,
): ProcessNotificationSendOptions {
  switch (attention) {
    case "turn":
      return { triggerTurn: true, deliverAs: "steer" };
    case "context":
      return { triggerTurn: false, deliverAs: "nextTurn" };
    case "ignore":
      return { triggerTurn: false, deliverAs: "nextTurn" };
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
