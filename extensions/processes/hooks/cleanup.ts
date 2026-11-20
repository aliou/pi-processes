import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import { LIVE_STATUSES } from "../../../src/types";
import type { NotificationRegistry } from "../notifications/registry";
import { appendStoppedProcessesEntry } from "./stopped-notice";

interface NotificationService {
  dispose(): void;
}

type Disposer = () => void;

interface CleanupHookDeps {
  manager: ProcessManager;
  notifications: NotificationRegistry;
  notificationService: NotificationService;
  disposers?: Disposer[];
  disposeOverlays?: () => void;
}

export function registerCleanupHook(
  pi: ExtensionAPI,
  deps: CleanupHookDeps,
): void {
  let shuttingDown = false;

  pi.on("session_shutdown", async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Close any open overview panels first so they stop listening to events
    // before the manager and protocol handlers are torn down.
    deps.disposeOverlays?.();

    for (const dispose of deps.disposers ?? []) {
      dispose();
    }

    deps.notificationService.dispose();
    deps.notifications.clear();

    const live = deps.manager
      .list()
      .filter((info) => LIVE_STATUSES.has(info.status));
    if (live.length > 0) {
      appendStoppedProcessesEntry(
        pi,
        live.map(({ name, command }) => ({ name, command })),
      );
    }

    deps.manager.killAll();
    deps.manager.cleanup();
  });
}
