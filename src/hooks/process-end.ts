import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { MESSAGE_TYPE_PROCESS_UPDATE, type ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { formatRuntime } from "../utils";

interface ProcessUpdateDetails {
  processId: string;
  processName: string;
  command: string;
  status: "exited" | "killed";
  exitCode: number | null;
  success: boolean;
  runtime: string;
}

export function setupProcessEndHook(pi: ExtensionAPI, manager: ProcessManager) {
  manager.onEvent((event) => {
    if (event.type !== "process_ended") return;

    const info: ProcessInfo = event.info;

    // Determine if the agent should get a turn to react to this process ending.
    // When true, the agent receives the message in its context and can respond
    // (e.g. check results, fix code, restart the process).
    const triggerAgentTurn =
      (info.status === "killed" && info.alertOnKill) ||
      (info.status === "exited" && info.success && info.alertOnSuccess) ||
      (info.status === "exited" && !info.success && info.alertOnFailure);

    const runtime = formatRuntime(info.startTime, info.endTime);

    // Build message
    let message: string;

    if (info.status === "killed") {
      message = `Process '${info.name}' was terminated (${runtime})`;
    } else if (info.success) {
      message = `Process '${info.name}' completed successfully (${runtime})`;
    } else {
      message = `Process '${info.name}' crashed with exit code ${info.exitCode ?? "?"} (${runtime})`;
    }

    // Send the message to the conversation - displayed via custom renderer in UI
    // Only trigger an agent turn when the notification preferences say so.
    const details: ProcessUpdateDetails = {
      processId: info.id,
      processName: info.name,
      command: info.command,
      status: info.status as "exited" | "killed",
      exitCode: info.exitCode,
      success: info.success ?? false,
      runtime,
    };

    pi.sendMessage(
      {
        customType: MESSAGE_TYPE_PROCESS_UPDATE,
        content: message,
        display: true,
        details,
      },
      { triggerTurn: triggerAgentTurn },
    );
  });
}
