import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "./constants";
import type { ProcessNotificationDetails } from "./notifications/types";

export interface ProcessNotificationMessage {
  content: string;
  details: ProcessNotificationDetails;
}

export function safeSendProcessNotificationMessage(
  pi: ExtensionAPI,
  message: ProcessNotificationMessage,
  options: {
    triggerTurn: boolean;
    deliverAs: "steer" | "followUp" | "nextTurn";
  },
): boolean {
  try {
    pi.sendMessage<ProcessNotificationDetails>(
      {
        customType: MESSAGE_TYPE_PROCESS_NOTIFICATION,
        content: message.content,
        display: true,
        details: message.details,
      },
      options,
    );
    return true;
  } catch {
    return false;
  }
}
