import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text } from "@earendil-works/pi-tui";

import type { ProcessManager } from "../../../src/manager";
import { ToolLayout } from "./components";
import { executeList, formatListDetails, type ListDetails } from "./list";
import * as listRender from "./list/render";
import { ProcessesParams, type ProcessesParamsType } from "./schema";
import { executeStart, formatStartDetails, type StartDetails } from "./start";
import * as startRender from "./start/render";
import { executeStop, formatStopDetails, type StopDetails } from "./stop";
import * as stopRender from "./stop/render";

type ProcessDetails = StartDetails | ListDetails | StopDetails;

export function registerProcessTool(
  pi: ExtensionAPI,
  manager: ProcessManager,
): void {
  pi.registerTool(
    defineTool({
      name: "process",
      label: "Process",
      description: "Start, list, and stop long-running background processes.",
      promptSnippet: "Start, list, and stop long-running background processes.",
      promptGuidelines: [
        "Use process when a command should keep running while the conversation continues, such as a dev server, watcher, or log tail.",
        "Use process start to start long-running background commands instead of shell background patterns like &, nohup, disown, or setsid.",
        "Use process list to inspect running background processes before starting duplicates; do not re-summarize the listed processes to the user because the tool output is already visible to them.",
        "Use process stop to stop a background process started with process start.",
      ],
      parameters: ProcessesParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const details = await execute(params, manager, ctx);
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
): Promise<ProcessDetails> {
  switch (params.action) {
    case "start":
      return executeStart(params, manager, ctx);
    case "list":
      return executeList(manager, params);
    case "stop":
      return executeStop(params, manager);
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
  if (details.action === "start") {
    return options.expanded
      ? startRender.buildExpanded(details, theme)
      : startRender.buildCollapsed(details, theme);
  }

  if (details.action === "list") {
    return options.expanded
      ? listRender.buildExpanded(details, theme)
      : listRender.buildCollapsed(details, theme);
  }

  return options.expanded
    ? stopRender.buildExpanded(details, theme)
    : stopRender.buildCollapsed(details, theme);
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
  }
}

function fallbackContainer(theme: Theme, message = "process"): Container {
  const container = new Container();
  container.addChild(new Text(theme.fg("muted", message), 0, 0));
  return container;
}
