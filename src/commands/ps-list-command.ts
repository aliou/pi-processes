import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ProcessesComponent } from "../components/processes-component";
import type { ProcessManager } from "../manager";
import type { DockStateManager } from "../state/dock-state";

export function registerPsListCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockState: DockStateManager,
): void {
  pi.registerCommand("ps:list", {
    description: "View and manage background processes (alias for /ps)",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
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
      });
    },
  });
}
