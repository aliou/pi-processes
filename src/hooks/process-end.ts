import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
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
  let latestContext: ExtensionContext | null = null;

  // Capture context from session events
  pi.on("session_start", async (_event, ctx) => {
    latestContext = ctx;
  });

  pi.on("turn_start", async (_event, ctx) => {
    latestContext = ctx;
  });

  pi.on("turn_end", async (_event, ctx) => {
    latestContext = ctx;
  });

  manager.onEvent((event) => {
    if (event.type !== "process_ended") return;

    const info: ProcessInfo = event.info;

    // Check notification preferences
    const shouldNotify =
      (info.status === "killed" && info.notifyOnKill) ||
      (info.status === "exited" && info.success && info.notifyOnSuccess) ||
      (info.status === "exited" && !info.success && info.notifyOnFailure);

    const runtime = formatRuntime(info.startTime, info.endTime);

    // Build notification message
    let message: string;
    let level: "info" | "error" | "warning";

    if (info.status === "killed") {
      message = `Process '${info.name}' was terminated (${runtime})`;
      level = "warning";
    } else if (info.success) {
      message = `Process '${info.name}' completed successfully (${runtime})`;
      level = "info";
    } else {
      message = `Process '${info.name}' crashed with exit code ${info.exitCode ?? "?"} (${runtime})`;
      level = "error";
    }

    // Always notify user via UI
    if (latestContext?.hasUI) {
      latestContext.ui.notify(message, level);
    }

    // Only send message to agent if notification preferences allow
    if (shouldNotify) {
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
        { triggerTurn: false },
      );
    }
  });
}
