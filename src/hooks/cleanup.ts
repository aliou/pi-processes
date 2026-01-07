import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";

export function setupCleanupHook(pi: ExtensionAPI, manager: ProcessManager) {
  pi.on("session_shutdown", async () => {
    manager.cleanup();
  });
}
