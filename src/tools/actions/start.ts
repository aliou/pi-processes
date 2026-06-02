import { basename } from "node:path";
import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { hyperlink, Text } from "@earendil-works/pi-tui";
import type { ExecuteResult, ProcessesDetails } from "../../constants";
import type { ProcessManager } from "../../manager";

type WatchStream = "stdout" | "stderr" | "both";

interface StartLogWatch {
  pattern: string;
  stream?: WatchStream;
  repeat?: boolean;
  maxWakes?: number;
  dedupe?: boolean;
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

  const stdoutLink = hyperlink(
    basename(process.stdoutFile),
    `file://${process.stdoutFile}`,
  );
  const stderrLink = hyperlink(
    basename(process.stderrFile),
    `file://${process.stderrFile}`,
  );

  const text =
    theme.fg("success", "\u2713 ") +
    theme.fg("accent", `"${process.name}"`) +
    " started" +
    theme.fg("muted", ` (${process.id}, PID: ${process.pid})`) +
    "\n" +
    theme.fg("muted", "  logs: ") +
    theme.fg("accent", stdoutLink) +
    theme.fg("muted", "  ") +
    theme.fg("accent", stderrLink);

  return new ToolBody(
    {
      fields: [new Text(text, 0, 0)],
    },
    options,
    theme,
  );
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

  let proc: ReturnType<ProcessManager["start"]>;
  try {
    proc = manager.start(params.name, params.command, params.cwd ?? ctx.cwd, {
      alertOnSuccess: params.alertOnSuccess,
      alertOnFailure: params.alertOnFailure,
      alertOnKill: params.alertOnKill,
      logWatches: params.logWatches,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? `Invalid start options: ${error.message}`
        : "Invalid start options";
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "start",
        success: false,
        message,
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

    if (
      watch.maxWakes !== undefined &&
      (typeof watch.maxWakes !== "number" ||
        !Number.isInteger(watch.maxWakes) ||
        watch.maxWakes < 0)
    ) {
      return `Invalid logWatches[${index}].maxWakes: expected a non-negative integer`;
    }

    if (watch.dedupe !== undefined && typeof watch.dedupe !== "boolean") {
      return `Invalid logWatches[${index}].dedupe: expected boolean`;
    }
  }

  return null;
}
