import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text } from "@earendil-works/pi-tui";

import type { ProcessManager } from "../../../src/manager";
import type { NotificationRegistry } from "../notifications/registry";
import { type ClearDetails, executeClear, formatClearDetails } from "./clear";
import * as clearRender from "./clear/render";
import { ToolLayout } from "./components";
import { executeList, formatListDetails, type ListDetails } from "./list";
import * as listRender from "./list/render";
import {
  executeOutput,
  formatOutputDetails,
  type OutputDetails,
} from "./output";
import * as outputRender from "./output/render";
import { ProcessesParams, type ProcessesParamsType } from "./schema";
import { executeStart, formatStartDetails, type StartDetails } from "./start";
import * as startRender from "./start/render";
import { executeStop, formatStopDetails, type StopDetails } from "./stop";
import * as stopRender from "./stop/render";
import {
  executeUpdate,
  formatUpdateDetails,
  type UpdateDetails,
} from "./update";
import * as updateRender from "./update/render";

type ProcessDetails =
  | StartDetails
  | ListDetails
  | StopDetails
  | OutputDetails
  | UpdateDetails
  | ClearDetails;

export function registerProcessTool(
  pi: ExtensionAPI,
  manager: ProcessManager,
  notifications: NotificationRegistry,
): void {
  pi.registerTool(
    defineTool({
      name: "process",
      label: "Process",
      description:
        "Start, list, stop, update, clear, and inspect output of long-running background processes.",
      promptSnippet:
        "Manage long-running background processes: start, list, stop, update watches, clear finished entries, and inspect recent output.",
      promptGuidelines: [
        "Use process list before process start when a similar dev server, watcher, or log tail may already be running; do not re-summarize visible tool output to the user.",
        "Use process start for long-running commands instead of shell background patterns like &, nohup, disown, or setsid; give each process a specific name.",
        "Use notify.logMatches on process start, and process update to change watches on a running process, instead of polling process output or restarting just to change watches.",
        "Use process output for targeted recent stdout/stderr inspection with pattern/mode filters; for deep log reads, use the log file paths from process list or process output with the read tool.",
        "Use process stop for obsolete live processes and process clear for finished entries; by default failures trigger an agent turn, successes add context, and killed processes are ignored unless notify overrides it.",
      ],
      parameters: ProcessesParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const details = await execute(params, manager, ctx, notifications);
        return {
          content: [{ type: "text", text: formatDetails(details) }],
          details,
        };
      },
      renderCall: renderProcessCall,
      renderResult: renderProcessResult,
    }),
  );
}

async function execute(
  params: ProcessesParamsType,
  manager: ProcessManager,
  ctx: ExtensionContext,
  notifications: NotificationRegistry,
): Promise<ProcessDetails> {
  switch (params.action) {
    case "start":
      return executeStart(params, manager, ctx, notifications);
    case "list":
      return executeList(manager, params);
    case "stop":
      return executeStop(params, manager, notifications);
    case "output":
      return executeOutput(params, manager);
    case "update":
      return executeUpdate(params, manager, notifications);
    case "clear":
      return executeClear(manager);
    default:
      throw new Error(`unsupported process action: ${String(params.action)}`);
  }
}

function renderProcessCall(
  args: ProcessesParamsType,
  theme: Theme,
  context?: { expanded?: boolean },
): Component {
  switch (args.action) {
    case "start":
      return new ToolLayout().setHeader(
        startRender.buildHeader(args, theme, context),
      );
    case "list":
      return new ToolLayout().setHeader(listRender.buildHeader(args, theme));
    case "stop":
      return new ToolLayout().setHeader(
        stopRender.buildHeader(args, theme, context),
      );
    case "output":
      return new ToolLayout().setHeader(
        outputRender.buildHeader(args, theme, context),
      );
    case "update":
      return new ToolLayout().setHeader(
        updateRender.buildHeader(args, theme, context),
      );
    case "clear":
      return new ToolLayout().setHeader(clearRender.buildHeader(args, theme));
    default:
      return fallbackContainer(theme);
  }
}

function renderProcessResult(
  result: { details?: unknown },
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
  context?: { isError?: boolean },
): Component {
  if (options.isPartial) {
    return fallbackContainer(theme, "process running...");
  }

  if (context?.isError) {
    return fallbackContainer(theme, "process failed");
  }

  const details = result.details as ProcessDetails | undefined;

  if (!details) {
    return fallbackContainer(theme, "process completed");
  }

  return new ToolLayout()
    .withSectionSpacing(options.expanded)
    .setBody(buildBody(details, options, theme))
    .setFooter(buildFooter(details, options, theme));
}

function buildBody(
  details: ProcessDetails,
  options: { expanded?: boolean },
  theme: Theme,
): Container {
  switch (details.action) {
    case "start":
      return options.expanded
        ? startRender.buildExpanded(details, theme)
        : startRender.buildCollapsed(details, theme);
    case "list":
      return options.expanded
        ? listRender.buildExpanded(details, theme)
        : listRender.buildCollapsed(details, theme);
    case "output":
      return options.expanded
        ? outputRender.buildExpanded(details, theme)
        : outputRender.buildCollapsed(details, theme);
    case "update":
      return options.expanded
        ? updateRender.buildExpanded(details, theme)
        : updateRender.buildCollapsed(details, theme);
    case "stop":
      return options.expanded
        ? stopRender.buildExpanded(details, theme)
        : stopRender.buildCollapsed(details, theme);
    case "clear":
      return options.expanded
        ? clearRender.buildExpanded(details, theme)
        : clearRender.buildCollapsed(details, theme);
  }
}

function buildFooter(
  details: ProcessDetails,
  options: { expanded?: boolean },
  theme: Theme,
): Container | null {
  switch (details.action) {
    case "start":
      return startRender.buildFooter(details, options, theme);
    case "list":
      return listRender.buildFooter(details, options, theme);
    case "stop":
      return stopRender.buildFooter(details, options, theme);
    case "output":
      return outputRender.buildFooter(details, options, theme);
    case "update":
      return updateRender.buildFooter(details, options, theme);
    case "clear":
      return clearRender.buildFooter(details, options, theme);
  }
}

function formatDetails(details: ProcessDetails): string {
  switch (details.action) {
    case "start":
      return formatStartDetails(details);
    case "list":
      return formatListDetails(details);
    case "stop":
      return formatStopDetails(details);
    case "output":
      return formatOutputDetails(details);
    case "update":
      return formatUpdateDetails(details);
    case "clear":
      return formatClearDetails(details);
  }
}

function fallbackContainer(theme: Theme, message = "process"): Container {
  const container = new Container();
  container.addChild(new Text(theme.fg("muted", message), 0, 0));
  return container;
}
