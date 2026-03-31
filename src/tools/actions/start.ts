import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ExecuteResult } from "../../constants";
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
  alertOnSuccess?: boolean;
  alertOnFailure?: boolean;
  alertOnKill?: boolean;
  logWatches?: StartLogWatch[];
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
    proc = manager.start(params.name, params.command, ctx.cwd, {
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
