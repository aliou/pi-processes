import { ToolBody } from "@aliou/pi-utils-ui";
import { StringEnum } from "@mariozechner/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
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
  "update",
  ...(DEBUG_PREVIEW_ENABLED ? (["debug_preview"] as const) : []),
] as const;

const ProcessesParams = Type.Object({
  action: StringEnum(PROCESS_ACTIONS, {
    description: DEBUG_PREVIEW_ENABLED
      ? "Action: start (run command), list (show all), output (get recent output), logs (get log file paths), kill (terminate), clear (remove finished), write (write to stdin), update (change mutable metadata/watches), debug_preview (temporary UI preview, no side effects)"
      : "Action: start (run command), list (show all), output (get recent output), logs (get log file paths), kill (terminate), clear (remove finished), write (write to stdin), update (change mutable metadata/watches)",
  }),
  command: Type.Optional(
    Type.String({ description: "Command to run (required for start)" }),
  ),
  name: Type.Optional(
    Type.String({
      description:
        "Friendly name for the process (required for start; optional new name for update, e.g. 'backend-dev', 'test-runner')",
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
  logWatchUpdate: Type.Optional(
    Type.Object(
      {
        mode: StringEnum(
          ["list", "append", "replace", "remove", "clear"] as const,
          {
            description:
              "How to update log watches. list shows current watches; append adds; replace removes existing and adds; remove deletes watchIndexes; clear removes all.",
          },
        ),
        watches: Type.Optional(
          Type.Array(
            Type.Object(
              {
                pattern: Type.String({
                  description:
                    "Regular expression pattern to match against per output line",
                }),
                stream: Type.Optional(
                  StringEnum(["stdout", "stderr", "both"] as const, {
                    description: "Which stream to watch (default both)",
                  }),
                ),
                repeat: Type.Optional(
                  Type.Boolean({
                    description:
                      "Trigger every time this pattern matches (default false, one-time)",
                  }),
                ),
              },
              { additionalProperties: false },
            ),
          ),
        ),
        watchIndexes: Type.Optional(
          Type.Array(Type.Number({ minimum: 0 }), {
            description: "For mode=remove: watch indexes to remove",
          }),
        ),
        replayTailLines: Type.Optional(
          Type.Number({
            minimum: 0,
            maximum: 10000,
            description:
              "For append/replace: scan this many recent stdout/stderr lines once for newly added watches (default 0, max 10000).",
          }),
        ),
        maxReplayMatches: Type.Optional(
          Type.Number({
            minimum: 0,
            maximum: 200,
            description:
              "For append/replace with replayTailLines: maximum replay matches returned (default 20, max 200).",
          }),
        ),
      },
      {
        additionalProperties: false,
        description:
          "For action=update only: structured log watch update. Prefer this over the flat watchAction fields when changing watches.",
      },
    ),
  ),
  watchAction: Type.Optional(
    StringEnum(["list", "append", "replace", "remove", "clear"] as const, {
      description:
        "For action=update only: flat alias for logWatchUpdate.mode. list shows current watches; append adds; replace removes existing and adds; remove deletes watchIndexes; clear removes all.",
    }),
  ),
  watchIndexes: Type.Optional(
    Type.Array(Type.Number({ minimum: 0 }), {
      description:
        "For action=update with watchAction=remove: watch indexes to remove",
    }),
  ),
  replayTailLines: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 10000,
      description:
        "For action=update append/replace: scan this many recent stdout/stderr lines once for newly added watches (default 0, max 10000).",
    }),
  ),
  maxReplayMatches: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 200,
      description:
        "For action=update append/replace with replayTailLines: maximum replay matches returned (default 20, max 200).",
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
  - alertOnSuccess (default: false): Get a turn to react when process completes successfully
  - alertOnFailure (default: true): Get a turn to react when process crashes/fails
  - alertOnKill (default: false): Get a turn to react if killed by external signal (killing via tool never triggers a turn)
  - logWatches (optional): Runtime output watches that trigger immediate alerts while running
    - pattern: regex string to match per output line
    - stream: stdout | stderr | both (default both)
    - repeat: false by default (single-fire). Set true for repeat alerts
- list: Show all managed processes with their IDs and names
- output: Get recent stdout/stderr (requires 'id')
- logs: Get log file paths to inspect with read tool (requires 'id')
- kill: Terminate a process (requires 'id')
- clear: Remove all finished processes from the list
- write: Write to process stdin (requires 'id' and 'input', optional 'end' to close stdin)
- update: Change mutable process metadata for a running or finished process (requires 'id')
  - name/alertOnSuccess/alertOnFailure/alertOnKill can be updated
  - logWatchUpdate.mode: list | append | replace | remove | clear
  - logWatchUpdate.watches: watches for append/replace
  - logWatchUpdate.watchIndexes: indexes for remove
  - logWatchUpdate.replayTailLines: optional bounded one-time scan of recent output for newly added/replaced watches (max 10000 lines; maxReplayMatches max 200)
${
  DEBUG_PREVIEW_ENABLED
    ? "- debug_preview: Temporary renderer preview for process tool UIs (no process side effects)\n  - preview: start | list | output | logs | error (default: start)\n"
    : ""
}
Important: You DON'T need to poll or wait for processes. Notifications arrive automatically based on your preferences. Start processes and continue with other work - you'll be informed if something requires attention.

Note: User always sees process updates in the UI. The notify flags control whether YOU (the agent) get a turn to react (e.g. check results, fix code, restart).`,
    promptSnippet:
      "Manage background processes without blocking the conversation",
    promptGuidelines: [
      "Use the process tool for long-running commands such as dev servers, test watchers, build watchers, and log tails instead of bash.",
      "Avoid shell background patterns such as &, nohup, disown, or setsid when the process tool fits.",
      "After starting a process, continue other work instead of waiting for it.",
      "After process start with alertOnSuccess, alertOnFailure, or logWatches, do not repeatedly call process output just to wait; do at most one quick sanity check, then continue independent work until a notification/watch event or a concrete next step needs logs.",
      "If a running process has missing, wrong, or noisy logWatches, use process action:'update' to append, replace, remove, or clear watches instead of polling output or restarting the process.",
      "If you add or replace watches after relevant output may have already appeared, use a small replayTailLines value instead of repeatedly polling process output.",
      "Use process output for targeted inspection after a watch/alert, after the user asks for status, or when a concrete next step depends on current logs.",
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

      return renderActionResult(result, options, theme);
    },
  });
}
