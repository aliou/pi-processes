import { ToolBody } from "@aliou/pi-utils-ui";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import type { ProcessesDetails } from "../constants";
import type { ProcessManager } from "../manager";
import { executeAction, renderActionCall, renderActionResult } from "./actions";

const DEBUG_PREVIEW_ENABLED = process.env.PI_PROCESSES_DEBUG_PREVIEW === "1";

const PROCESS_ACTIONS = [
  "start",
  "list",
  "output",
  "logs",
  "kill",
  "clear",
  "write",
  ...(DEBUG_PREVIEW_ENABLED ? (["debug_preview"] as const) : []),
] as const;

const ProcessesParams = Type.Object({
  action: StringEnum(PROCESS_ACTIONS, {
    description: DEBUG_PREVIEW_ENABLED
      ? "Action: start (run command), list (show all), output (get recent output), logs (get log file paths), kill (terminate), clear (remove finished), write (write to stdin), debug_preview (temporary UI preview, no side effects)"
      : "Action: start (run command), list (show all), output (get recent output), logs (get log file paths), kill (terminate), clear (remove finished), write (write to stdin)",
  }),
  command: Type.Optional(
    Type.String({ description: "Command to run (required for start)" }),
  ),
  name: Type.Optional(
    Type.String({
      description:
        "Friendly name for the process (required for start, e.g. 'backend-dev', 'test-runner')",
    }),
  ),
  id: Type.Optional(
    Type.String({
      description:
        "Process ID, returned by start and list actions (required for output/kill/logs/write)",
    }),
  ),
  input: Type.Optional(
    Type.String({
      description: "Data to write to process stdin (required for write action)",
    }),
  ),
  end: Type.Optional(
    Type.Boolean({
      description:
        "Close stdin after writing (optional for write action, use for programs reading until EOF)",
    }),
  ),
  alertOnSuccess: Type.Optional(
    Type.Boolean({
      description:
        "Get a turn to react when process completes successfully (default: false). Use for builds/tests where you need confirmation.",
    }),
  ),
  alertOnFailure: Type.Optional(
    Type.Boolean({
      description:
        "Get a turn to react when process fails/crashes (default: true). Use to be alerted of unexpected failures.",
    }),
  ),
  alertOnKill: Type.Optional(
    Type.Boolean({
      description:
        "Get a turn to react when process is killed by external signal (default: false). Note: killing via tool never triggers a turn.",
    }),
  ),
  preview: Type.Optional(
    StringEnum(["start", "list", "output", "logs", "error"] as const, {
      description:
        "For action=debug_preview only: which rendered result variant to preview (default: start)",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for the command (for start action). Defaults to the session working directory. Prefer this over 'cd dir && command' shell wrappers.",
    }),
  ),
  logWatches: Type.Optional(
    Type.Array(
      Type.Object(
        {
          pattern: Type.String({
            description:
              "Regular expression pattern to match against process output lines",
          }),
          stream: Type.Optional(
            StringEnum(["stdout", "stderr", "both"] as const, {
              description:
                "Which stream to watch (default: both). Use stdout/stderr to reduce noise.",
            }),
          ),
          repeat: Type.Optional(
            Type.Boolean({
              description:
                "Trigger every time this pattern matches (default: false, one-time)",
            }),
          ),
          maxWakes: Type.Optional(
            Type.Integer({
              minimum: 0,
              description:
                "Max alert wakes for this watch before further matches are suppressed (one budget-reached notice is sent). Default: 20. Set 0 for unlimited. Mainly relevant with repeat:true.",
            }),
          ),
          dedupe: Type.Optional(
            Type.Boolean({
              description:
                "Suppress consecutive matches with an identical matched line (default: false). Useful when the same line repeats in a tight loop.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  ),
});

type ProcessesParamsType = Static<typeof ProcessesParams>;

export function setupProcessesTools(pi: ExtensionAPI, manager: ProcessManager) {
  pi.registerTool<typeof ProcessesParams, ProcessesDetails>({
    name: "process",
    label: "Process",
    description: `Manage background processes. Actions:
- start: Run command in background (requires 'name' and 'command')
  - cwd (optional): Working directory for the command. Defaults to the session working directory. Use the cwd parameter instead of 'cd dir && command' shell wrappers.
  - alertOnSuccess (default: false): Get a turn to react when process completes successfully
  - alertOnFailure (default: true): Get a turn to react when process crashes/fails
  - alertOnKill (default: false): Get a turn to react if killed by external signal (killing via tool never triggers a turn)
  - logWatches (optional): Runtime output watches that trigger immediate alerts while running
    - pattern: regex string to match per output line
    - stream: stdout | stderr | both (default both)
    - repeat: false by default (single-fire). Set true for repeat alerts
    - maxWakes: per-watch wake budget (default 20, 0=unlimited); noisy repeat watches stop after the budget with one notice
    - dedupe: suppress consecutive identical matched lines (default false)
- list: Show all managed processes with their IDs and names
- output: Get recent stdout/stderr (requires 'id')
- logs: Get log file paths to inspect with read tool (requires 'id')
- kill: Terminate a process (requires 'id')
- clear: Remove all finished processes from the list (finished processes beyond the retention cap are already dropped automatically; their log files stay readable)
- write: Write to process stdin (requires 'id' and 'input', optional 'end' to close stdin)
${
  DEBUG_PREVIEW_ENABLED
    ? "- debug_preview: Temporary renderer preview for process tool UIs (no process side effects)\n  - preview: start | list | output | logs | error (default: start)\n"
    : ""
}
Important: NEVER poll or wait for a process. Do not call output/list repeatedly, do not sleep, and do not run a second command to watch the first. Completion and alert notices are delivered to you as soon as they happen, even while you are executing other tool calls, whenever alertOnSuccess/alertOnFailure/alertOnKill or a logWatch applies. Start the process, continue with other work, and react when the notice arrives.

Note: User always sees process updates in the UI. The notify flags control whether YOU (the agent) get a turn to react (e.g. check results, fix code, restart).`,
    promptSnippet:
      "Manage background processes without blocking the conversation",
    promptGuidelines: [
      "Use the process tool for long-running commands such as dev servers, test watchers, build watchers, and log tails instead of bash.",
      "Avoid shell background patterns such as &, nohup, disown, or setsid when the process tool fits.",
      "After starting a process, continue other work instead of waiting for it. Never poll with output or list: completion notices arrive on their own, even mid-turn.",
      "Use the pi-processes skill for examples and best practices when a task depends on background processes.",
    ],

    parameters: ProcessesParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeAction(params, manager, ctx);
    },

    renderCall(args: ProcessesParamsType, theme: Theme, _context) {
      return renderActionCall(args, theme);
    },

    renderResult(
      result: AgentToolResult<ProcessesDetails>,
      options: ToolRenderResultOptions,
      theme: Theme,
      _context,
    ) {
      if (options.isPartial) {
        return new Text(theme.fg("muted", "Process: running..."), 0, 0);
      }

      const { details } = result;

      // Framework sets details to {} when tool throws.
      // Detect by checking for missing expected fields.
      if (!details?.action) {
        const textBlock = result.content.find((c) => c.type === "text");
        const errorMsg =
          (textBlock?.type === "text" && textBlock.text) ||
          "Tool execution failed";
        return new Text(theme.fg("error", errorMsg), 0, 0);
      }

      if (!details.success) {
        return new ToolBody(
          {
            fields: [
              {
                label: "Error",
                value: theme.fg("error", details.message),
                showCollapsed: true,
              },
            ],
          },
          options,
          theme,
        );
      }

      return renderActionResult(result, options, theme, _context);
    },
  });
}
