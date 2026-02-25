import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ProcessesComponent } from "../components/processes-component";
import type { ProcessManager } from "../manager";
import type { DockStateManager } from "../state/dock-state";

export function registerPsCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockState: DockStateManager,
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
                dockState.setFocus(processId);
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
