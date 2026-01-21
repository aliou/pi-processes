import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";
import { setupCleanupHook } from "./cleanup";
import { setupMessageRenderer } from "./message-renderer";
import { setupProcessEndHook } from "./process-end";
import { setupProcessStatusUpdater } from "./status-updater";
import { setupProcessWidget } from "./widget";

export function setupProcessesHooks(pi: ExtensionAPI, manager: ProcessManager) {
  setupCleanupHook(pi, manager);
  setupProcessEndHook(pi, manager);

  // Set up status updater AFTER process-end so it chains onto the existing callback
  const statusUpdater = setupProcessStatusUpdater(pi, manager);

  // Set up widget (also chains onto process end callback)
  const widgetUpdater = setupProcessWidget(pi, manager);

  setupMessageRenderer(pi);

  // Return combined updater
  return {
    update: () => {
      statusUpdater.update();
      widgetUpdater.update();
    },
  };
}
