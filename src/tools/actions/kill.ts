import type { ExecuteResult } from "../../constants";
import type { ProcessManager } from "../../manager";

interface KillParams {
  id?: string;
}

export async function executeKill(
  params: KillParams,
  manager: ProcessManager,
): Promise<ExecuteResult> {
  if (!params.id) {
    return {
      content: [{ type: "text", text: "Missing required parameter: id" }],
      details: {
        action: "kill",
        success: false,
        message: "Missing required parameter: id",
      },
    };
  }

  const proc = manager.find(params.id);
  if (!proc) {
    const message = `Process not found: ${params.id}`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "kill",
        success: false,
        message,
      },
    };
  }

  const result = await manager.kill(proc.id, {
    signal: "SIGTERM",
    timeoutMs: 3000,
  });

  if (result.ok) {
    const message = `Terminated "${proc.name}" (${proc.id})`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "kill",
        success: true,
        message,
      },
    };
  }

  if (result.reason === "timeout") {
    const message =
      `SIGTERM timed out for "${proc.name}" (${proc.id}). ` +
      "Run /process:list and press x on terminate_timeout to force kill (SIGKILL).";
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "kill",
        success: false,
        message,
      },
    };
  }

  const message = `Failed to terminate "${proc.name}" (${proc.id})`;
  return {
    content: [{ type: "text", text: message }],
    details: {
      action: "kill",
      success: false,
      message,
    },
  };
}
