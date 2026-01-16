import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";
import { setupCleanupHook } from "./cleanup";
import { setupMessageRenderer } from "./message-renderer";
import { setupProcessEndHook } from "./process-end";
import { setupProcessStatusUpdater } from "./status-updater";

export function setupProcessesHooks(pi: ExtensionAPI, manager: ProcessManager) {
  setupCleanupHook(pi, manager);
  setupProcessEndHook(pi, manager);

  // Set up status updater AFTER process-end so it chains onto the existing callback
  const statusUpdater = setupProcessStatusUpdater(pi, manager);

  setupMessageRenderer(pi);

  return statusUpdater;
}
