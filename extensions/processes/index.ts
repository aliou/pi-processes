import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { getManager } from "../../src/get-manager";
import { registerCleanupHook } from "./hooks/cleanup";
import { registerProcessNotificationRenderer } from "./message-renderer";
import { registerProcessTool } from "./tools";

export default function processesExtension(pi: ExtensionAPI): void {
  const manager = getManager();

  registerProcessNotificationRenderer(pi);
  registerProcessTool(pi, manager);
  registerCleanupHook(pi, manager);
}
