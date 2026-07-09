import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getManager } from "../../src/get-manager";
import { registerOverviewCommand } from "./commands/overview";
import { configLoader, drainImportMessages, loadProcessConfig } from "./config";
import { registerCommandHandlers } from "./handlers/commands";
import { registerNotificationDelivery } from "./handlers/notifications";
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
  await loadProcessConfig();
  registerMigrationMessageNotifications(pi);

  const manager = getManager({
    getConfiguredShellPath: () => configLoader.getConfig().execution.shellPath,
  });
  const notifications = createNotificationRegistry();
  const notificationService = createNotificationService({
    events: pi.events,
    manager,
    registry: notifications,
    getProcess: (id) => manager.get(id),
  });

  const getConfig = () => configLoader.getConfig();

  const openOverlays = new Set<{ dispose: () => void }>();
  const registerOverlay = (overlay: { dispose: () => void }) => {
    openOverlays.add(overlay);
    return () => openOverlays.delete(overlay);
  };

  const disposers = [
    registerEventBridge(pi.events, manager),
    registerRequestHandlers(pi.events, manager, getConfig),
    registerCommandHandlers(pi.events, manager, notifications),
    registerLogSubscriptions(pi.events, manager),
    registerNotificationDelivery(pi.events, pi),
  ];

  registerBackgroundBlocker(
    pi,
    () => getConfig().interception.blockBackgroundCommands,
  );

  registerProcessNotificationRenderer(pi);
  registerProcessTool(pi, manager, notifications);
  registerProcessSettings(pi);
  registerOverviewCommand(pi, { events: pi.events, registerOverlay });

  registerCleanupHook(pi, {
    manager,
    notifications,
    notificationService,
    disposers,
    disposeOverlays: () => {
      for (const overlay of [...openOverlays]) overlay.dispose();
      openOverlays.clear();
    },
  });
}

function registerMigrationMessageNotifications(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const messages = [
      ...drainImportMessages(),
      ...configLoader.drainMessages(),
    ];
    if (messages.length === 0) return;

    const formattedMessages = messages.map((m) => `- ${m}`);

    const message = `[processes]\n${formattedMessages.join("\n")}`;
    if (ctx.hasUI) {
      ctx.ui.notify(message, "info");
    }
  });
}
