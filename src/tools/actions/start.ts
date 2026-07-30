import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { ExecuteResult, ProcessesDetails } from "../../constants";
import type { ProcessManager } from "../../manager";

type WatchStream = "stdout" | "stderr" | "both";

interface StartLogWatch {
  pattern: string;
  stream?: WatchStream;
  repeat?: boolean;
}

interface StartParams {
  name?: string;
  command?: string;
  cwd?: string;
  alertOnSuccess?: boolean;
  alertOnFailure?: boolean;
  alertOnKill?: boolean;
  logWatches?: StartLogWatch[];
}

export function renderStartCall(
  args: StartParams,
  theme: Theme,
): ToolCallHeader {
  const longArgs: Array<{ label?: string; value: string }> = [];
  const optionArgs: Array<{ label: string; value: string }> = [];
  let mainArg: string | undefined;

  if (args.name) {
    mainArg = `"${args.name}"`;
  }

  if (args.command) {
    if (!mainArg && args.command.length <= 60) {
      mainArg = args.command;
    } else if (args.command.length <= 60) {
      optionArgs.push({ label: "command", value: args.command });
    } else {
      longArgs.push({ label: "command", value: args.command });
    }
  }

  if (args.logWatches && args.logWatches.length > 0) {
    optionArgs.push({
      label: "watches",
      value: String(args.logWatches.length),
    });
  }

  return new ToolCallHeader(
    {
      toolName: "Process",
      action: "start",
      mainArg,
      optionArgs,
      longArgs,
    },
    theme,
  );
}

export function renderStartResult(
  result: AgentToolResult<ProcessesDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
): ToolBody {
  const { details } = result;
  const process = details.process;

  if (!details.success) {
    return new ToolBody(
      {
        fields: [
          {
            label: "Error",
            value: details.message,
            showCollapsed: true,
          },
        ],
      },
      options,
      theme,
    );
  }

  if (!process) {
    return new ToolBody(
      {
        fields: [
          {
            label: "Error",
            value: "Missing process details",
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
        theme.fg("success", "Started process"),
        `  name: ${theme.fg("accent", process.name)}`,
        `  command: ${process.command}`,
        `  id: ${theme.fg("accent", process.id)}`,
        `  pid: ${String(process.pid)}`,
        "  Log files:",
        `    - stdout: ${theme.fg("accent", process.stdoutFile)}`,
        `    - stderr: ${theme.fg("accent", process.stderrFile)}`,
      ].join("\n"),
      0,
      0,
    ),
    {
      label: "Status",
      value:
        theme.fg("success", "Started") +
        ` ${theme.fg("accent", `"${process.name}"`)} (${process.id}, PID: ${process.pid})`,
      showCollapsed: true,
    },
  ];

  return new ToolBody({ fields }, options, theme);
}

export async function executeStart(
  params: StartParams,
  manager: ProcessManager,
  ctx: ExtensionContext,
): Promise<ExecuteResult> {
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

  const watchValidationError = validateLogWatches(params.logWatches);
  if (watchValidationError) {
    return {
      content: [{ type: "text", text: watchValidationError }],
      details: {
        action: "start",
        success: false,
        message: watchValidationError,
      },
    };
  }

  let proc: Awaited<ReturnType<ProcessManager["start"]>>;
  try {
    proc = await manager.start(
      params.name,
      params.command,
      params.cwd ?? ctx.cwd,
      {
        alertOnSuccess: params.alertOnSuccess,
        alertOnFailure: params.alertOnFailure,
        alertOnKill: params.alertOnKill,
        logWatches: params.logWatches,
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? `Failed to start "${params.name}": ${error.message}`
        : `Failed to start "${params.name}"`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "start",
        success: false,
        message,
      },
    };
  }

  if (proc.error || proc.pid <= 0) {
    const reason = proc.error ?? "process did not receive a valid PID";
    const message = `Failed to start "${proc.name}" (${proc.id}): ${reason}`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "start",
        success: false,
        message,
        process: proc,
      },
    };
  }

  const message = [
    `Started "${proc.name}" (${proc.id}, PID: ${proc.pid})`,
    "Log files:",
    `  stdout: ${proc.stdoutFile}`,
    `  stderr: ${proc.stderrFile}`,
  ].join("\n");
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

function validateLogWatches(watches?: StartLogWatch[]): string | null {
  if (!watches) return null;

  if (!Array.isArray(watches)) {
    return "Invalid parameter: logWatches must be an array";
  }

  for (const [index, watch] of watches.entries()) {
    if (!watch || typeof watch !== "object") {
      return `Invalid logWatches[${index}]: expected an object`;
    }

    if (
      typeof watch.pattern !== "string" ||
      watch.pattern.trim().length === 0
    ) {
      return `Invalid logWatches[${index}].pattern: expected non-empty string`;
    }

    try {
      // Validate regex syntax at process start for fast feedback.
      new RegExp(watch.pattern);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "invalid regular expression";
      return `Invalid logWatches[${index}].pattern: ${message}`;
    }

    if (
      watch.stream !== undefined &&
      watch.stream !== "stdout" &&
      watch.stream !== "stderr" &&
      watch.stream !== "both"
    ) {
      return `Invalid logWatches[${index}].stream: expected stdout, stderr, or both`;
    }

    if (watch.repeat !== undefined && typeof watch.repeat !== "boolean") {
      return `Invalid logWatches[${index}].repeat: expected boolean`;
    }
  }

  return null;
}
