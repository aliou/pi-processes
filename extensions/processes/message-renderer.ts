import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { renderProcessNotificationMessage } from "./components/notification-message";
import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "./constants";
import type { ProcessNotificationDetails } from "./notifications/types";

export function registerProcessNotificationRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<ProcessNotificationDetails>(
    MESSAGE_TYPE_PROCESS_NOTIFICATION,
    renderProcessNotificationMessage,
  );
}
