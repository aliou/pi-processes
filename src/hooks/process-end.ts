import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { MESSAGE_TYPE_PROCESS_UPDATE } from "../constants";
import type { ProcessInfo, ProcessManager } from "../manager";

function formatRuntime(startTime: number, endTime: number | null): string {
  const end = endTime ?? Date.now();
  const ms = end - startTime;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

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

  // Set callback for process end events
  manager.onProcessEnd = (info: ProcessInfo) => {
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

    // Notify user via UI if available
    if (latestContext?.hasUI) {
      latestContext.ui.notify(message, level);
    }

    // Send message to session for the agent
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
      { triggerTurn: false, deliverAs: "followUp" },
    );
  };
}
