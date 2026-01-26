import type { ExecuteResult } from "../../constants";
import type { ProcessManager } from "../../manager";
import { formatStatus } from "../../utils";

interface OutputParams {
  id?: string;
}

export function executeOutput(
  params: OutputParams,
  manager: ProcessManager,
): ExecuteResult {
  if (!params.id) {
    return {
      content: [{ type: "text", text: "Missing required parameter: id" }],
      details: {
        action: "output",
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
        action: "output",
        success: false,
        message,
      },
    };
  }

  const output = manager.getOutput(proc.id);
  if (!output) {
    const message = `Could not read output for: ${proc.id}`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "output",
        success: false,
        message,
      },
    };
  }

  const stdoutLines = output.stdout.length;
  const stderrLines = output.stderr.length;
  const message = `"${proc.name}" (${proc.id}) [${formatStatus(proc)}]: ${stdoutLines} stdout lines, ${stderrLines} stderr lines`;

  const outputParts: string[] = [message];
  if (output.stdout.length > 0) {
    outputParts.push("\n--- stdout (last 100 lines) ---");
    outputParts.push(...output.stdout.slice(-100));
  }
  if (output.stderr.length > 0) {
    outputParts.push("\n--- stderr (last 100 lines) ---");
    outputParts.push(...output.stderr.slice(-100));
  }

  return {
    content: [{ type: "text", text: outputParts.join("\n") }],
    details: {
      action: "output",
      success: true,
      message,
      output,
    },
  };
}
