import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";

export function registerCleanupHook(
  pi: ExtensionAPI,
  manager: ProcessManager,
): void {
  pi.on("session_shutdown", async () => {
    manager.killAll();
    manager.cleanup();
  });
}
