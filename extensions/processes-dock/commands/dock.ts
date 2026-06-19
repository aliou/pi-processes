import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { DockController } from "../widget/setup";

const ACTIONS = [
  {
    value: "expand",
    description: "Show the expanded dock.",
  },
  {
    value: "collapse",
    description: "Show the compact dock.",
  },
  {
    value: "close",
    description: "Close the dock.",
  },
];

export function registerDockCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  getController: () => DockController | null,
): void {
  pi.registerCommand("ps:dock", {
    description: "Expand, collapse, or close the managed process dock.",
    getArgumentCompletions: (prefix: string) => completions(prefix),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const controller = getController();
      if (!controller) {
        report(ctx, "Process dock is only available in UI mode.", "warning");
        return;
      }

      const action = args.trim().split(/\s+/, 1)[0] || "expand";
      if (action === "expand") controller.actions.expand();
      else if (action === "collapse") controller.actions.collapse();
      else if (action === "close") controller.actions.close();
      else {
        report(ctx, "Usage: /ps:dock [expand|collapse|close]", "warning");
        return;
      }

      controller.refresh();
    },
  });
}

function completions(prefix: string): AutocompleteItem[] | null {
  const normalized = prefix.trim().toLowerCase();
  const items = ACTIONS.filter((action) =>
    action.value.startsWith(normalized),
  ).map((action) => ({
    value: action.value,
    label: action.value,
    description: action.description,
  }));
  return items.length > 0 ? items : null;
}

function report(
  ctx: ExtensionCommandContext,
  message: string,
  level: "info" | "warning",
): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
  else console.log(message);
}
