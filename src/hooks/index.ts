import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";
import { setupCleanupHook } from "./cleanup";
import { setupMessageRenderer } from "./message-renderer";
import { setupProcessEndHook } from "./process-end";

export function setupProcessesHooks(pi: ExtensionAPI, manager: ProcessManager) {
  setupCleanupHook(pi, manager);
  setupProcessEndHook(pi, manager);
  setupMessageRenderer(pi);
}
