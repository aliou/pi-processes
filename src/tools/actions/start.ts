import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ExecuteResult } from "../../constants";
import type { ProcessManager } from "../../manager";

interface StartParams {
  name?: string;
  command?: string;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  notifyOnKill?: boolean;
}

export function executeStart(
  params: StartParams,
  manager: ProcessManager,
  ctx: ExtensionContext,
): ExecuteResult {
  if (!params.name) {
    return {
      content: [{ type: "text", text: "Missing required parameter: name" }],
      details: {
        action: "start",
        success: false,
        message: "Missing required parameter: name",
      },
    };
  }
  if (!params.command) {
    return {
      content: [{ type: "text", text: "Missing required parameter: command" }],
      details: {
        action: "start",
        success: false,
        message: "Missing required parameter: command",
      },
    };
  }

  const proc = manager.start(params.name, params.command, ctx.cwd, {
    notifyOnSuccess: params.notifyOnSuccess,
    notifyOnFailure: params.notifyOnFailure,
    notifyOnKill: params.notifyOnKill,
  });

  const message = `Started "${proc.name}" (${proc.id}, PID: ${proc.pid})\nLogs: ${proc.stdoutFile}`;
  return {
    content: [{ type: "text", text: message }],
    details: {
      action: "start",
      success: true,
      message,
      process: proc,
    },
  };
}
