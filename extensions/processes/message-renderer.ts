import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { renderProcessNotificationMessage } from "./components/notification-message";
import { renderStoppedNoticeMessage } from "./components/stopped-notice-message";
import {
  MESSAGE_TYPE_PROCESS_NOTIFICATION,
  MESSAGE_TYPE_PROCESSES_STOPPED,
} from "./constants";
import type { ProcessesStoppedDetails } from "./hooks/stopped-notice";
import type { ProcessNotificationDetails } from "./notifications/types";

export function registerProcessMessageRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<ProcessNotificationDetails>(
    MESSAGE_TYPE_PROCESS_NOTIFICATION,
    renderProcessNotificationMessage,
  );
  pi.registerMessageRenderer<ProcessesStoppedDetails>(
    MESSAGE_TYPE_PROCESSES_STOPPED,
    renderStoppedNoticeMessage,
  );
}
