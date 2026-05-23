import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import type { NotificationRegistry } from "../notifications/registry";

interface NotificationService {
  dispose(): void;
}

export function registerCleanupHook(
  pi: ExtensionAPI,
  manager: ProcessManager,
  notifications: NotificationRegistry,
  notificationService: NotificationService,
): void {
  pi.on("session_shutdown", async () => {
    notificationService.dispose();
    notifications.clear();
    manager.killAll();
    manager.cleanup();
  });
}
