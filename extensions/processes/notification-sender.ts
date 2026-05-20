import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "./constants";
import { buildProcessNotificationContent } from "./notifications/render-content";
import type { ProcessNotificationDetails } from "./notifications/types";

export interface ProcessNotificationSendOptions {
  triggerTurn: boolean;
  deliverAs: "steer" | "followUp" | "nextTurn";
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
