import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";
import type { DockStateManager } from "../state/dock-state";
import { allProcessCompletions } from "./completions";
import { pickProcess } from "./pick-process";

export function registerPsFocusCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockState: DockStateManager,
): void {
  pi.registerCommand("ps:focus", {
    description: "Focus on a process to view its logs in the dock",
    getArgumentCompletions: allProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();

      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          return;
        }
        processId = proc.id;
      } else {
        processId = await pickProcess(ctx, manager, "Select process to focus");
        if (!processId) return;
      }

      // Focus on the process (auto-shows dock if hidden)
      dockState.setFocus(processId);
    },
  });
}
