import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { LogOverlayComponent } from "../components/log-overlay-component";
import type { ProcessManager } from "../manager";
import { allProcessCompletions } from "./completions";

export function registerPsLogsCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
): void {
  pi.registerCommand("ps:logs", {
    description: "Open log viewer overlay for a process",
    getArgumentCompletions: allProcessCompletions(manager),
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;

      const arg = args.trim();
      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) return;
        processId = proc.id;
      }

      await ctx.ui.custom<null>(
        (_tui, theme, _kb, done) => {
          return new LogOverlayComponent({
            tui: _tui,
            theme,
            manager,
            initialProcessId: processId,
            done: () => done(null),
          });
        },
        {
          overlay: true,
          overlayOptions: {
            width: "90%",
            maxHeight: "80%",
            anchor: "center",
          },
        },
      );
    },
  });
}
