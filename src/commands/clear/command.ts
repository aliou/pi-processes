import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../../manager";

export function registerPsClearCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
): void {
  pi.registerCommand("ps:clear", {
    description: "Remove all finished processes from the list",
    handler: async (_args, _ctx) => {
      manager.clearFinished();
    },
  });
}
