import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ProcessesComponent } from "../../components/processes-component";
import type { DockActions } from "../../hooks/widget";
import type { ProcessManager } from "../../manager";

export function registerPsCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockActions: DockActions,
): void {
  pi.registerCommand("ps", {
    description: "View and manage background processes",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      const result = await ctx.ui.custom<string | null>(
        (tui, theme, _keybindings, done) => {
          return new ProcessesComponent(
            tui,
            theme,
            (processId?: string) => {
              if (processId) {
                dockActions.setFocus(processId);
              }
              done(processId ?? null);
            },
            manager,
          );
        },
      );

      if (result === undefined) {
        return;
      }
    },
  });
}
