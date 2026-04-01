import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { ExecuteResult, ProcessesDetails } from "../../constants";
import type { ProcessManager } from "../../manager";

interface LogsParams {
  id?: string;
}

export function renderLogsCall(args: LogsParams, theme: Theme): ToolCallHeader {
  return new ToolCallHeader(
    {
      toolName: "Process",
      action: "logs",
      mainArg: args.id,
    },
    theme,
  );
}

export function renderLogsResult(
  result: AgentToolResult<ProcessesDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
): ToolBody {
  const { details } = result;

  if (!details.logFiles) {
    return new ToolBody(
      {
        fields: [
          {
            label: "Error",
            value: "Missing log file details",
            showCollapsed: true,
          },
        ],
      },
      options,
      theme,
    );
  }

  const fields: Array<
    { label: string; value: string; showCollapsed?: boolean } | Text
  > = [
    new Text(
      [
        theme.fg("success", "Log files:"),
        `  stdout: ${theme.fg("accent", details.logFiles.stdoutFile)}`,
        `  stderr: ${theme.fg("accent", details.logFiles.stderrFile)}`,
      ].join("\n"),
      0,
      0,
    ),
  ];

  return new ToolBody({ fields }, options, theme);
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

  const proc = manager.get(params.id);
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
    const message = `Could not get log files for "${proc.name}" (${proc.id})`;
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
