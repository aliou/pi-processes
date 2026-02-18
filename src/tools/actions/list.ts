import type { ExecuteResult } from "../../constants";
import type { ProcessManager } from "../../manager";
import { formatRuntime, formatStatus, truncateCmd } from "../../utils";

export function executeList(manager: ProcessManager): ExecuteResult {
  const processes = manager.list();

  if (processes.length === 0) {
    return {
      content: [{ type: "text", text: "No background processes running" }],
      details: {
        action: "list",
        success: true,
        message: "No background processes running",
        processes: [],
      },
    };
  }

  const summary = processes
    .map(
      (p) =>
        `${p.id} "${p.name}": ${truncateCmd(p.command)} [${formatStatus(p)}] ${formatRuntime(p.startTime, p.endTime)}`,
    )
    .join("\n");

  const message = `${processes.length} process(es):\n${summary}`;
  return {
    content: [{ type: "text", text: message }],
    details: {
      action: "list",
      success: true,
      message,
      processes,
    },
  };
}
