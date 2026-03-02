import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { LIVE_STATUSES } from "../../constants";
import type { DockActions } from "../../hooks/widget";
import type { ProcessManager } from "../../manager";
import { runningProcessCompletions } from "../completions";
import { pickProcess } from "../pick-process";

export function registerPsKillCommand(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockActions: DockActions,
): void {
  pi.registerCommand("ps:kill", {
    description: "Kill a running process",
    getArgumentCompletions: runningProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();

      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          return;
        }
        if (!LIVE_STATUSES.has(proc.status)) {
          return;
        }
        processId = proc.id;
      } else {
        const running = manager
          .list()
          .filter((p) => LIVE_STATUSES.has(p.status));

        if (running.length === 0) {
          return;
        }

        if (running.length === 1 && running[0]) {
          processId = running[0].id;
        } else {
          processId = await pickProcess(
            ctx,
            manager,
            "Select process to kill",
            (p) => LIVE_STATUSES.has(p.status),
          );
          if (!processId) return;
        }
      }

      const proc = manager.get(processId);
      if (!proc) {
        return;
      }

      const signal =
        proc.status === "terminate_timeout" ? "SIGKILL" : "SIGTERM";
      const timeoutMs = signal === "SIGKILL" ? 200 : 3000;
      const result = await manager.kill(processId, { signal, timeoutMs });

      if (result.ok) {
        if (dockActions.getFocusedProcessId() === processId) {
          dockActions.setFocus(null);
        }
      }
    },
  });
}
