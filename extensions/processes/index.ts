import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getManager } from "../../src/get-manager";
import { registerCommandHandlers } from "./handlers/commands";
import { registerRequestHandlers } from "./handlers/requests";
import { registerLogSubscriptions } from "./handlers/subscriptions";
import { registerCleanupHook } from "./hooks/cleanup";
import { registerEventBridge } from "./hooks/event-bridge";
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

  const disposers = [
    registerEventBridge(pi.events, manager),
    registerRequestHandlers(pi.events, manager),
    registerCommandHandlers(pi.events, manager, notifications),
    registerLogSubscriptions(pi.events, manager),
  ];

  registerProcessNotificationRenderer(pi);
  registerProcessTool(pi, manager, notifications);
  registerCleanupHook(pi, {
    manager,
    notifications,
    notificationService,
    disposers,
  });
}
