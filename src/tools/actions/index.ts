import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ExecuteResult } from "../../constants";
import type { ProcessManager } from "../../manager";
import { executeClear } from "./clear";
import { executeKill } from "./kill";
import { executeList } from "./list";
import { executeLogs } from "./logs";
import { executeOutput } from "./output";
import { executeStart } from "./start";

interface ActionParams {
  action: string;
  command?: string;
  name?: string;
  id?: string;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  notifyOnKill?: boolean;
}

export async function executeAction(
  params: ActionParams,
  manager: ProcessManager,
  ctx: ExtensionContext,
): Promise<ExecuteResult> {
  switch (params.action) {
    case "start":
      return executeStart(params, manager, ctx);
    case "list":
      return executeList(manager);
    case "output":
      return executeOutput(params, manager);
    case "logs":
      return executeLogs(params, manager);
    case "kill":
      return executeKill(params, manager);
    case "clear":
      return executeClear(manager);
    default:
      return {
        content: [{ type: "text", text: `Unknown action: ${params.action}` }],
        details: {
          action: params.action,
          success: false,
          message: `Unknown action: ${params.action}`,
        },
      };
  }
}
