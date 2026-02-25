import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";
import type { DockStateManager } from "../state/dock-state";
import { allProcessCompletions } from "./completions";
import { pickProcess } from "./pick-process";

export function registerPsLogsCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockState: DockStateManager,
): void {
  pi.registerCommand("ps:logs", {
    description: "Show log file paths for a process",
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
        processId = await pickProcess(ctx, manager, "Select process for logs");
        if (!processId) return;
      }

      // Focus on the process and expand dock to show logs
      dockState.setState({
        focusedProcessId: processId,
        visibility: "open",
      });
    },
  });
}
