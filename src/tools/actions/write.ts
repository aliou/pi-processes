import type { ExecuteResult } from "../../constants";
import type { ProcessManager } from "../../manager";

interface WriteParams {
  id?: string;
  input?: string;
  end?: boolean;
}

export function executeWrite(
  params: WriteParams,
  manager: ProcessManager,
): ExecuteResult {
  const { id, input, end } = params;

  if (!id) {
    return {
      content: [{ type: "text", text: "Missing required parameter: id" }],
      details: {
        action: "write",
        success: false,
        message: "Missing required parameter: id",
      },
    };
  }

  if (input === undefined) {
    return {
      content: [{ type: "text", text: "Missing required parameter: input" }],
      details: {
        action: "write",
        success: false,
        message: "Missing required parameter: input",
      },
    };
  }

  const process = manager.find(id);
  if (!process) {
    return {
      content: [{ type: "text", text: `Process not found: ${id}` }],
      details: {
        action: "write",
        success: false,
        message: `Process not found: ${id}`,
      },
    };
  }

  const result = manager.writeToStdin(process.id, input, { end });

  if (!result.ok) {
    const messages: Record<string, string> = {
      not_found: `Process not found: ${process.id}`,
      process_exited: `Process has already exited: ${process.id}`,
      stdin_closed: `Stdin already closed for process: ${process.id}`,
      write_error: `Failed to write to stdin for process: ${process.id}`,
    };

    const message =
      messages[result.reason] || `Unknown error: ${result.reason}`;

    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "write",
        success: false,
        message,
      },
    };
  }

  const suffix = end ? " (stdin closed)" : "";
  return {
    content: [
      {
        type: "text",
        text: `Wrote ${input.length} bytes to ${process.id}${suffix}`,
      },
    ],
    details: {
      action: "write",
      success: true,
      message: `Wrote ${input.length} bytes to process stdin${suffix}`,
    },
  };
}
