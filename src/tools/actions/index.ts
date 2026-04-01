import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import type {
  ExecuteResult,
  ProcessAction,
  ProcessesDetails,
} from "../../constants";
import type { ProcessManager } from "../../manager";
import { executeClear } from "./clear";
import { executeDebugPreview, renderDebugCall } from "./debug";
import { executeKill, renderKillCall } from "./kill";
import { executeList, renderListResult } from "./list";
import { executeLogs, renderLogsCall, renderLogsResult } from "./logs";
import { executeOutput, renderOutputCall, renderOutputResult } from "./output";
import { executeStart, renderStartCall, renderStartResult } from "./start";
import { executeWrite, renderWriteCall } from "./write";

const DEBUG_PREVIEW_ENABLED = process.env.PI_PROCESSES_DEBUG_PREVIEW === "1";

interface ActionParams {
  action: ProcessAction | string;
  command?: string;
  name?: string;
  id?: string;
  input?: string;
  end?: boolean;
  alertOnSuccess?: boolean;
  alertOnFailure?: boolean;
  alertOnKill?: boolean;
  logWatches?: Array<{
    pattern: string;
    stream?: "stdout" | "stderr" | "both";
    repeat?: boolean;
  }>;
  preview?: "start" | "list" | "output" | "logs" | "error";
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
    case "write":
      return executeWrite(params, manager);
    case "debug_preview":
      if (!DEBUG_PREVIEW_ENABLED) {
        throw new Error(
          "Action 'debug_preview' is disabled. Set PI_PROCESSES_DEBUG_PREVIEW=1 to enable.",
        );
      }
      return executeDebugPreview(params);
    default:
      return {
        content: [{ type: "text", text: `Unknown action: ${params.action}` }],
        details: {
          action: params.action as ProcessAction,
          success: false,
          message: `Unknown action: ${params.action}`,
        },
      };
  }
}

export function renderActionCall(
  args: ActionParams,
  theme: Theme,
): Component | undefined {
  switch (args.action) {
    case "start":
      return renderStartCall(args, theme);
    case "output":
      return renderOutputCall(args, theme);
    case "logs":
      return renderLogsCall(args, theme);
    case "kill":
      return renderKillCall(args, theme);
    case "write":
      return renderWriteCall(args, theme);
    case "debug_preview":
      return renderDebugCall(args, theme);
    default:
      return new ToolCallHeader(
        { toolName: "Process", action: args.action },
        theme,
      );
  }
}

export function renderActionResult(
  result: AgentToolResult<ProcessesDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
): Component | undefined {
  const { details } = result;

  if (!details) {
    return undefined;
  }

  switch (details.action) {
    case "start":
      return renderStartResult(result, options, theme);
    case "list":
      return renderListResult(result, options, theme);
    case "output":
      return renderOutputResult(result, options, theme);
    case "logs":
      return renderLogsResult(result, options, theme);
    case "kill":
    case "write":
    case "clear":
    case "debug_preview":
      // Default rendering for these actions
      return new ToolBody(
        {
          fields: [
            {
              label: "Result",
              value: details.message,
              showCollapsed: true,
            },
          ],
        },
        options,
        theme,
      );
    default:
      return undefined;
  }
}
