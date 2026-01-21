import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";
import { setupCleanupHook } from "./cleanup";
import { setupMessageRenderer } from "./message-renderer";
import { setupProcessEndHook } from "./process-end";
import { setupProcessWidget } from "./widget";

export function setupProcessesHooks(pi: ExtensionAPI, manager: ProcessManager) {
  setupCleanupHook(pi, manager);
  setupProcessEndHook(pi, manager);

  // Set up widget AFTER process-end so it chains onto the existing callback
  setupProcessWidget(pi, manager);

  setupMessageRenderer(pi);
}
