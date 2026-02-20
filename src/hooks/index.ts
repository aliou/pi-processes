import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ResolvedProcessesConfig } from "../config";
import type { ProcessManager } from "../manager";
import { setupBackgroundBlocker } from "./background-blocker";
import { setupCleanupHook } from "./cleanup";
import { setupMessageRenderer } from "./message-renderer";
import { setupProcessEndHook } from "./process-end";
import { setupProcessWidget } from "./widget";

export function setupProcessesHooks(
  pi: ExtensionAPI,
  manager: ProcessManager,
  config: ResolvedProcessesConfig,
) {
  setupCleanupHook(pi, manager);
  setupProcessEndHook(pi, manager);

  if (config.interception.blockBackgroundCommands) {
    setupBackgroundBlocker(pi);
  }

  // Set up widget AFTER process-end so it chains onto the existing callback
  const widget = setupProcessWidget(pi, manager);

  setupMessageRenderer(pi);

  return widget;
}
