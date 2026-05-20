import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type {
  ExecuteResult,
  LogWatch,
  LogWatchUpdate,
  LogWatchUpdateMode,
  ProcessesDetails,
} from "../../constants";
import type { ProcessManager } from "../../manager";

type WatchStream = "stdout" | "stderr" | "both";

interface UpdateParams {
  id?: string;
  name?: string;
  alertOnSuccess?: boolean;
  alertOnFailure?: boolean;
  alertOnKill?: boolean;
  watchAction?: LogWatchUpdateMode;
  logWatchUpdate?: LogWatchUpdate;
  logWatches?: Array<{
    pattern: string;
    stream?: WatchStream;
    repeat?: boolean;
  }>;
  watchIndexes?: number[];
  replayTailLines?: number;
  maxReplayMatches?: number;
}

export function renderUpdateCall(
  args: UpdateParams,
  theme: Theme,
): ToolCallHeader {
  const optionArgs: Array<{ label: string; value: string }> = [];
  if (args.name) optionArgs.push({ label: "name", value: args.name });
  const watchMode = args.logWatchUpdate?.mode ?? args.watchAction;
  if (watchMode) {
    optionArgs.push({ label: "watches", value: watchMode });
  }

  return new ToolCallHeader(
    {
      toolName: "Process",
      action: "update",
      mainArg: args.id,
      optionArgs,
    },
    theme,
  );
}

export function renderUpdateResult(
  result: AgentToolResult<ProcessesDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
): ToolBody {
  const { details } = result;

  const lines: string[] = [
    details.success
      ? theme.fg("success", details.message)
      : theme.fg("error", details.message),
  ];

  if (details.watches && details.watches.length > 0) {
    lines.push("", theme.fg("accent", "log watches:"));
    for (const watch of details.watches.slice(0, 8)) {
      lines.push(
        `  [${watch.index}] /${watch.pattern}/ ${watch.stream}${watch.repeat ? " repeat" : " once"}${watch.fired ? " fired" : ""}`,
      );
    }
    if (details.watches.length > 8) {
      lines.push(theme.fg("muted", `  ... ${details.watches.length - 8} more`));
    }
  }

  if (details.replayMatches && details.replayMatches.length > 0) {
    lines.push("", theme.fg("accent", "replay matches:"));
    for (const match of details.replayMatches.slice(0, 6)) {
      lines.push(`  [${match.watchIndex}] ${match.source}: ${match.line}`);
    }
    if (details.replayMatches.length > 6) {
      lines.push(
        theme.fg(
          "muted",
          `  ... ${details.replayMatches.length - 6} more replay matches`,
        ),
      );
    }
  }

  const fields: Array<
    { label: string; value: string; showCollapsed?: boolean } | Text
  > = [new Text(lines.join("\n"), 0, 0)];

  fields.push({
    label: "Result",
    value: details.message,
    showCollapsed: true,
  });

  return new ToolBody({ fields }, options, theme);
}

export function executeUpdate(
  params: UpdateParams,
  manager: ProcessManager,
): ExecuteResult {
  if (!params.id) {
    return {
      content: [{ type: "text", text: "Missing required parameter: id" }],
      details: {
        action: "update",
        success: false,
        message: "Missing required parameter: id",
      },
    };
  }

  const logWatchUpdate =
    params.logWatchUpdate ??
    (params.watchAction
      ? {
          mode: params.watchAction,
          watches: params.logWatches as LogWatch[] | undefined,
          watchIndexes: params.watchIndexes,
          replayTailLines: params.replayTailLines,
          maxReplayMatches: params.maxReplayMatches,
        }
      : undefined);

  const result = manager.update(params.id, {
    name: params.name,
    alertOnSuccess: params.alertOnSuccess,
    alertOnFailure: params.alertOnFailure,
    alertOnKill: params.alertOnKill,
    logWatchUpdate,
  });

  if (!result.ok) {
    return {
      content: [{ type: "text", text: result.message }],
      details: {
        action: "update",
        success: false,
        message: result.message,
        process: result.info,
        watches: result.watches,
      },
    };
  }

  const replayText =
    result.replayMatches.length > 0
      ? `, ${result.replayMatches.length} replay match(es)`
      : "";
  const changed =
    params.name !== undefined ||
    params.alertOnSuccess !== undefined ||
    params.alertOnFailure !== undefined ||
    params.alertOnKill !== undefined ||
    (logWatchUpdate !== undefined && logWatchUpdate.mode !== "list");
  const message = changed
    ? `Updated "${result.info.name}" (${result.info.id}): ${result.watches.length} watch(es) active${replayText}. Continue other work; watch/exit notifications will trigger follow-up.`
    : `Process metadata for "${result.info.name}" (${result.info.id}): ${result.watches.length} watch(es) active${replayText}.`;

  return {
    content: [{ type: "text", text: message }],
    details: {
      action: "update",
      success: true,
      message,
      process: result.info,
      watches: result.watches,
      replayMatches: result.replayMatches,
    },
  };
}
