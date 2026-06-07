import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import type { NotificationRegistry } from "../notifications/registry";

interface NotificationService {
  dispose(): void;
}

type Disposer = () => void;

interface CleanupHookDeps {
  manager: ProcessManager;
  notifications: NotificationRegistry;
  notificationService: NotificationService;
  disposers?: Disposer[];
}

export function registerCleanupHook(
  pi: ExtensionAPI,
  deps: CleanupHookDeps,
): void {
  let shuttingDown = false;

  pi.on("session_shutdown", async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    for (const dispose of deps.disposers ?? []) {
      dispose();
    }

    deps.notificationService.dispose();
    deps.notifications.clear();
    deps.manager.killAll();
    deps.manager.cleanup();
  });
}
