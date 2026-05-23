import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getManager } from "../../src/get-manager";
import { registerCleanupHook } from "./hooks/cleanup";
import { registerProcessNotificationRenderer } from "./message-renderer";
import {
  createNotificationRegistry,
  createNotificationService,
} from "./notifications/service";
import { registerProcessTool } from "./tools";

export default function processesExtension(pi: ExtensionAPI): void {
  const manager = getManager();
  const notifications = createNotificationRegistry();
  const notificationService = createNotificationService({
    pi,
    manager,
    registry: notifications,
    getProcess: (id) => manager.get(id),
  });

  registerProcessNotificationRenderer(pi);
  registerProcessTool(pi, manager, notifications);
  registerCleanupHook(pi, manager, notifications, notificationService);
}
