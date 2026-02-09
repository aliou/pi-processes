import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ProcessesComponent } from "../components/processes-component";
import type { ProcessManager } from "../manager";

export function setupProcessesCommands(
  pi: ExtensionAPI,
  manager: ProcessManager,
) {
  pi.registerCommand("processes", {
    description: "View and manage background processes",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/processes requires interactive mode", "error");
        return;
      }
      const result = await ctx.ui.custom<null>(
        (tui, theme, _keybindings, done) => {
          return new ProcessesComponent(tui, theme, () => done(null), manager);
        },
      );

      // RPC fallback
      if (result === undefined) {
        ctx.ui.notify("/processes requires interactive mode", "info");
      }
    },
  });
}
