import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { DockActions } from "../../hooks/widget";
import type { ProcessManager } from "../../manager";
import { allProcessCompletions } from "../completions";
import { pickProcess } from "../pick-process";

export function registerPsPinCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockActions: DockActions,
): void {
  pi.registerCommand("ps:pin", {
    description: "Pin the dock to a specific process",
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
        processId = await pickProcess(ctx, manager, "Select process to pin");
        if (!processId) return;
      }

      dockActions.setFocus(processId);
    },
  });
}
