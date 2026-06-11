import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text } from "@earendil-works/pi-tui";

import type { ProcessManager } from "../../../src/manager";
import type { NotificationRegistry } from "../notifications/registry";
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
  | UpdateDetails;

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
        "Start, list, stop, update, and inspect output of long-running background processes.",
      promptSnippet:
        "Start, list, stop, update, and inspect output of long-running background processes.",
      promptGuidelines: [
        "Use process when a command should keep running while the conversation continues, such as a dev server, watcher, or log tail.",
        "Use process start to start long-running background commands instead of shell background patterns like &, nohup, disown, or setsid.",
        "Use process list to inspect running background processes before starting duplicates; do not re-summarize the listed processes to the user because the tool output is already visible to them.",
        "Use process stop to stop a background process started with process start.",
        "Use process output to inspect recent stdout/stderr of a background process. Use pattern and mode to filter for specific lines, such as errors or readiness signals.",
        "By default, process failures trigger an agent turn, successes add context only, and killed processes are ignored. Use notify to override.",
        "Use notify.logMatches on start to get notified when output matches a readiness or error pattern. Log matchers control agent attention, not display.",
        "Use process update to rename a running process or modify log watches on a running process. Only running processes can be updated.",
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
    default:
      return fallbackContainer(theme);
  }
}

function renderProcessResult(
  result: { details?: unknown },
  options: { expanded?: boolean },
  theme: Theme,
): Component {
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
  }
}

function fallbackContainer(theme: Theme, message = "process"): Container {
  const container = new Container();
  container.addChild(new Text(theme.fg("muted", message), 0, 0));
  return container;
}
