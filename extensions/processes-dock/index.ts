import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDockCommand } from "./commands/dock";
import { registerPinCommand } from "./commands/pin";
import { type DockController, setupDockWidgets } from "./widget/setup";

export default async function processesDockExtension(
  pi: ExtensionAPI,
): Promise<void> {
  let controller: DockController | null = null;

  registerDockCommand(pi, () => controller);
  registerPinCommand(pi, pi.events, () => controller);

  pi.on("session_start", async (_event, ctx) => {
    controller?.dispose();
    controller = setupDockWidgets(ctx, pi.events);
  });

  pi.on("session_shutdown", () => {
    controller?.dispose();
    controller = null;
  });
}
