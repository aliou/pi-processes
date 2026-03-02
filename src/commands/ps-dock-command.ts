import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { DockActions } from "../hooks/widget";

export function registerPsDockCommand(
  pi: ExtensionAPI,
  dockActions: DockActions,
): void {
  pi.registerCommand("ps:dock", {
    description: "Control dock visibility",
    getArgumentCompletions: () => [
      { value: "show", label: "show — make the dock visible" },
      { value: "hide", label: "hide — hide the dock" },
      { value: "toggle", label: "toggle — cycle visibility" },
    ],
    handler: async (args, _ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "show") {
        dockActions.expand();
      } else if (arg === "hide") {
        dockActions.hide();
      } else if (arg === "toggle" || arg === "") {
        dockActions.toggle();
      } else {
        dockActions.toggle();
      }
    },
  });
}
