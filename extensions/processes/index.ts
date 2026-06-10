import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getManager } from "../../src/get-manager";
import { configLoader } from "./config";
import { registerCommandHandlers } from "./handlers/commands";
import { registerRequestHandlers } from "./handlers/requests";
import { registerLogSubscriptions } from "./handlers/subscriptions";
import { registerBackgroundBlocker } from "./hooks/background-blocker";
import { registerCleanupHook } from "./hooks/cleanup";
import { registerEventBridge } from "./hooks/event-bridge";
import { registerProcessNotificationRenderer } from "./message-renderer";
import {
  createNotificationRegistry,
  createNotificationService,
} from "./notifications/service";
import { registerProcessSettings } from "./settings";
import { registerProcessTool } from "./tools";

export default async function processesExtension(
  pi: ExtensionAPI,
): Promise<void> {
  // Load config. If the config file is malformed, fall back to defaults
  // rather than preventing the extension from initialising.
  try {
    await configLoader.load();
  } catch {
    // ConfigLoader.load() throws on unreadable files; defaults are still
    // available via getConfig() after a failed load.
    void 0;
  }

  const manager = getManager({
    getConfiguredShellPath: () => configLoader.getConfig().execution.shellPath,
  });
  const notifications = createNotificationRegistry();
  const notificationService = createNotificationService({
    pi,
    manager,
    registry: notifications,
    getProcess: (id) => manager.get(id),
  });

  const getConfig = () => configLoader.getConfig();

  const disposers = [
    registerEventBridge(pi.events, manager),
    registerRequestHandlers(pi.events, manager, getConfig),
    registerCommandHandlers(pi.events, manager, notifications),
    registerLogSubscriptions(pi.events, manager),
  ];

  registerBackgroundBlocker(
    pi,
    () => getConfig().interception.blockBackgroundCommands,
  );

  registerProcessNotificationRenderer(pi);
  registerProcessTool(pi, manager, notifications);
  registerProcessSettings(pi);

  registerCleanupHook(pi, {
    manager,
    notifications,
    notificationService,
    disposers,
  });
}
