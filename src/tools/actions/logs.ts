import type { ExecuteResult } from "../../constants";
import type { ProcessManager } from "../../manager";

interface LogsParams {
  id?: string;
}

export function executeLogs(
  params: LogsParams,
  manager: ProcessManager,
): ExecuteResult {
  if (!params.id) {
    return {
      content: [{ type: "text", text: "Missing required parameter: id" }],
      details: {
        action: "logs",
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
        action: "logs",
        success: false,
        message,
      },
    };
  }

  const logFiles = manager.getLogFiles(proc.id);
  if (!logFiles) {
    const message = `Could not get log files for: ${proc.id}`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "logs",
        success: false,
        message,
      },
    };
  }

  const message = `Log files for "${proc.name}" (${proc.id}):\n  stdout: ${logFiles.stdoutFile}\n  stderr: ${logFiles.stderrFile}\n\nUse the read tool to inspect these files.`;
  return {
    content: [{ type: "text", text: message }],
    details: {
      action: "logs",
      success: true,
      message,
      logFiles,
    },
  };
}
