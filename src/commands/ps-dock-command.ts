import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { DockActions } from "../hooks/widget";

export function registerPsDockCommand(
  pi: ExtensionAPI,
  dockActions: DockActions,
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
        dockActions.expand();
      } else if (arg === "off") {
        dockActions.hide();
      } else if (arg === "expanded") {
        dockActions.expand();
      } else {
        dockActions.toggle();
      }
    },
  });
}
