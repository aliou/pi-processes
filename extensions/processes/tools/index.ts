import {
  type AgentToolResult,
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
import { executeOutput, type OutputDetails } from "./output";
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
import { executeWrite, formatWriteDetails, type WriteDetails } from "./write";
import * as writeRender from "./write/render";

type ProcessDetails =
  | StartDetails
  | ListDetails
  | StopDetails
  | OutputDetails
  | WriteDetails
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
        "Start, list, stop, write to stdin, update, clear, and inspect output of long-running background processes.",
      promptSnippet:
        "Manage long-running background processes: start, list, stop, write to stdin, update watches, clear finished entries, and inspect recent output. After starting a process, do not wait - notifications bring you back on exit and on log matches.",
      promptGuidelines: [
        "process tool: use process start for long-running commands (dev servers, watchers, builds) instead of shell background patterns like &, nohup, or setsid; give each process a specific name and check process list first when a duplicate would be noisy.",
        "process tool: after process start, do not sleep, poll, or hold your turn. End your turn or move on. Exits and notify.logMatches matches bring you back.",
        "process tool: attention turn wakes you when idle; context only reaches you if you are still working; ignore never notifies. Keep turn for anything whose result you need.",
        "process tool: use notify.logMatches to get brought back on readiness or error signals instead of polling process output. If a watch is too noisy, use process update (watches.mode append/replace/remove/clear) to fix it without restarting.",
        "process tool: for the full lifecycle (start, list, output, update, write, stop, clear), notify options, use cases, and noisy-watch handling, read the pi-processes skill.",
      ],
      parameters: ProcessesParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (params.action === "output") {
          const result = executeOutput(params, manager);
          return {
            content: [{ type: "text", text: result.content }],
            details: result.details,
          };
        }

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
      return executeList(manager, params, notifications);
    case "stop":
      return executeStop(params, manager, notifications);
    case "write":
      return executeWrite(params, manager);
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
    case "write":
      return new ToolLayout().setHeader(
        writeRender.buildHeader(args, theme, context),
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
  result: AgentToolResult<ProcessDetails>,
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

  const contentText = getContentText(result);

  return new ToolLayout()
    .withSectionSpacing(options.expanded)
    .setBody(buildBody(details, contentText, options, theme))
    .setFooter(buildFooter(details, contentText, options, theme));
}

function getContentText(
  result: AgentToolResult<ProcessDetails>,
): string | undefined {
  const first = result.content[0];
  if (first?.type === "text" && typeof first.text === "string") {
    return first.text;
  }
  return undefined;
}

function buildBody(
  details: ProcessDetails,
  contentText: string | undefined,
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
        ? outputRender.buildExpanded(contentText ?? "", details, theme)
        : outputRender.buildCollapsed(contentText ?? "", details, theme);
    case "update":
      return options.expanded
        ? updateRender.buildExpanded(details, theme)
        : updateRender.buildCollapsed(details, theme);
    case "write":
      return options.expanded
        ? writeRender.buildExpanded(details, theme)
        : writeRender.buildCollapsed(details, theme);
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
  _contentText: string | undefined,
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
    case "write":
      return writeRender.buildFooter(details, options, theme);
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
    case "update":
      return formatUpdateDetails(details);
    case "write":
      return formatWriteDetails(details);
    case "clear":
      return formatClearDetails(details);
    case "output":
      throw new Error("output action uses pre-formatted content");
  }
}

function fallbackContainer(theme: Theme, message = "process"): Container {
  const container = new Container();
  container.addChild(new Text(theme.fg("muted", message), 0, 0));
  return container;
}
