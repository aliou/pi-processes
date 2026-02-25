import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { DockStateManager } from "../state/dock-state";

export function registerPsDockCommand(
  pi: ExtensionAPI,
  dockState: DockStateManager,
): void {
  pi.registerCommand("ps:dock", {
    description: "Toggle dock visibility (on/off/expanded)",
    getArgumentCompletions: () => [
      { value: "on", label: "on" },
      { value: "off", label: "off" },
      { value: "expanded", label: "expanded" },
    ],
    handler: async (args, _ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "on") {
        dockState.expand();
      } else if (arg === "off") {
        dockState.hide();
      } else if (arg === "expanded") {
        dockState.expand();
      } else {
        dockState.toggleVisibility();
      }
    },
  });
}
