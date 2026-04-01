import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import { StringEnum } from "@mariozechner/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { ProcessesDetails } from "../constants";
import type { ProcessManager } from "../manager";
import { formatRuntime, hasAnsi, stripAnsi } from "../utils";
import { executeAction } from "./actions";

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
  ...(DEBUG_PREVIEW_ENABLED
    ? {
        preview: Type.Optional(
          StringEnum(["start", "list", "output", "logs", "error"] as const, {
            description:
              "For action=debug_preview only: which rendered result variant to preview (default: start)",
          }),
        ),
      }
    : {}),
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
      "Use this tool for long-running commands such as dev servers, test watchers, build watchers, and log tails instead of bash.",
      "Avoid shell background patterns such as &, nohup, disown, or setsid when the process tool fits.",
      "After starting a process, continue other work instead of waiting for it.",
      "Use the pi-processes skill for examples and best practices when a task depends on background processes.",
    ],

    parameters: ProcessesParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeAction(params, manager, ctx);
    },

    renderCall(args: ProcessesParamsType, theme: Theme) {
      const longArgs: Array<{ label?: string; value: string }> = [];
      const optionArgs: Array<{ label: string; value: string }> = [];
      let mainArg: string | undefined;

      if (args.action === "start") {
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
      }

      if (
        (args.action === "output" ||
          args.action === "kill" ||
          args.action === "logs" ||
          args.action === "write") &&
        args.id
      ) {
        mainArg = args.id;
      }

      if (args.action === "debug_preview" && args.preview) {
        mainArg = args.preview;
      }

      if (args.action === "write" && args.input) {
        optionArgs.push({ label: "input", value: args.input });
        if (args.end) {
          optionArgs.push({ label: "end", value: "true" });
        }
      }

      return new ToolCallHeader(
        {
          toolName: "Process",
          action: args.action,
          mainArg,
          optionArgs,
          longArgs,
        },
        theme,
      );
    },

    renderResult(
      result: AgentToolResult<ProcessesDetails>,
      options: ToolRenderResultOptions,
      theme: Theme,
    ) {
      const { details } = result;

      if (!details) {
        const message = result.content
          .map((part) =>
            part.type === "text" && "text" in part && part.text
              ? part.text
              : "",
          )
          .join("\n")
          .trim();

        return new Text(message || "Tool execution failed", 0, 0);
      }

      const fields: Array<
        { label: string; value: string; showCollapsed?: boolean } | Text
      > = [];

      const formatTimestamp = (ts: number | null): string => {
        if (!ts) return "-";
        return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
      };

      const formatStatusTag = (process: {
        status: string;
        success: boolean | null;
        exitCode: number | null;
      }): string => {
        switch (process.status) {
          case "running":
            return theme.fg("accent", "running");
          case "terminating":
            return theme.fg("warning", "terminating");
          case "terminate_timeout":
            return theme.fg("error", "terminate_timeout");
          case "killed":
            return theme.fg("warning", "killed");
          case "exited":
            return process.success
              ? theme.fg("success", "exit(0)")
              : theme.fg("error", `exit(${process.exitCode ?? "?"})`);
          default:
            return theme.fg("muted", process.status);
        }
      };

      if (!details.success) {
        fields.push({
          label: "Error",
          value: theme.fg("error", details.message),
          showCollapsed: true,
        });
      } else if (details.action === "start" && details.process) {
        const process = details.process;

        fields.push(
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
        );

        fields.push({
          label: "Status",
          value:
            theme.fg("success", "Started") +
            ` ${theme.fg("accent", `"${process.name}"`)} (${process.id}, PID: ${process.pid})`,
          showCollapsed: true,
        });
      } else if (details.action === "output" && details.output) {
        const lines: string[] = [theme.fg("muted", details.message)];
        let hadAnsi = false;

        if (details.output.stdout.length > 0) {
          lines.push("", theme.fg("accent", "stdout:"));
          for (const line of details.output.stdout.slice(-20)) {
            if (!hadAnsi && hasAnsi(line)) hadAnsi = true;
            lines.push(stripAnsi(line));
          }
          if (details.output.stdout.length > 20) {
            lines.push(
              theme.fg(
                "muted",
                `... (${details.output.stdout.length - 20} more lines)`,
              ),
            );
          }
        }

        if (details.output.stderr.length > 0) {
          lines.push("", theme.fg("warning", "stderr:"));
          for (const line of details.output.stderr.slice(-10)) {
            if (!hadAnsi && hasAnsi(line)) hadAnsi = true;
            lines.push(theme.fg("warning", stripAnsi(line)));
          }
          if (details.output.stderr.length > 10) {
            lines.push(
              theme.fg(
                "muted",
                `... (${details.output.stderr.length - 10} more lines)`,
              ),
            );
          }
        }

        if (details.logFiles) {
          lines.push(
            "",
            theme.fg("success", "Log files:"),
            `  stdout: ${theme.fg("accent", details.logFiles.stdoutFile)}`,
            `  stderr: ${theme.fg("accent", details.logFiles.stderrFile)}`,
          );
        }

        if (hadAnsi) {
          lines.push(
            "",
            theme.fg("muted", "ANSI escape codes were stripped from output"),
          );
        }

        fields.push(new Text(lines.join("\n"), 0, 0));

        // Collapsed summary
        const previewSource =
          details.output.stdout.length > 0
            ? details.output.stdout
            : details.output.stderr;
        const preview = previewSource
          .slice(-2)
          .map((l) => stripAnsi(l))
          .join("\n");
        fields.push({
          label: "Output",
          value: preview
            ? `${theme.fg("muted", preview)}`
            : theme.fg("muted", "(empty)"),
          showCollapsed: true,
        });
      } else if (
        details.action === "list" &&
        details.processes &&
        details.processes.length > 0
      ) {
        const processes = [...details.processes];
        const statusRank = (status: string): number => {
          switch (status) {
            case "running":
              return 0;
            case "terminating":
              return 1;
            case "terminate_timeout":
              return 2;
            case "killed":
              return 3;
            case "exited":
              return 4;
            default:
              return 5;
          }
        };

        processes.sort((a, b) => {
          const rankDiff = statusRank(a.status) - statusRank(b.status);
          if (rankDiff !== 0) return rankDiff;
          return b.startTime - a.startTime;
        });

        const runningCount = processes.filter(
          (p) => p.status === "running" || p.status === "terminating",
        ).length;

        const lines: string[] = [
          theme.fg(
            "success",
            `${processes.length} process(es), ${runningCount} running/terminating`,
          ),
        ];

        for (const process of processes) {
          const status = formatStatusTag(process);
          lines.push(
            [
              `- ${theme.fg("accent", process.name)} ${theme.fg("muted", `(${process.id})`)}`,
              `  pid: ${process.pid}   status: ${status}`,
              `  started: ${theme.fg("muted", formatTimestamp(process.startTime))}`,
              `  ended:   ${theme.fg("muted", formatTimestamp(process.endTime))}`,
              `  runtime: ${theme.fg("muted", formatRuntime(process.startTime, process.endTime))}`,
            ].join("\n"),
          );
        }

        fields.push(new Text(lines.join("\n"), 0, 0));

        const running = details.processes.filter(
          (p) => p.status === "running" || p.status === "terminating",
        );
        const finishedOk = details.processes.filter(
          (p) => p.status === "exited" && p.success,
        ).length;
        const failed = details.processes.filter(
          (p) => p.status === "exited" && !p.success,
        ).length;
        const killed = details.processes.filter(
          (p) => p.status === "killed",
        ).length;

        const runningSummary =
          running.length > 0
            ? running
                .slice(0, 3)
                .map(
                  (p) =>
                    `${theme.fg("accent", `"${p.name}"`)} [${formatStatusTag(p)}]`,
                )
                .join(", ")
            : theme.fg("muted", "no running process");

        const restParts: string[] = [];
        if (finishedOk > 0) restParts.push(`${finishedOk} finished`);
        if (failed > 0) restParts.push(`${failed} failed`);
        if (killed > 0) restParts.push(`${killed} killed`);
        const restSummary =
          restParts.length > 0
            ? theme.fg("muted", ` + ${restParts.join(", ")}`)
            : "";

        fields.push({
          label: "Processes",
          value: runningSummary + restSummary,
          showCollapsed: true,
        });
      } else if (details.action === "logs" && details.logFiles) {
        fields.push(
          new Text(
            [
              theme.fg("success", "Log files:"),
              `  stdout: ${theme.fg("accent", details.logFiles.stdoutFile)}`,
              `  stderr: ${theme.fg("accent", details.logFiles.stderrFile)}`,
            ].join("\n"),
            0,
            0,
          ),
        );
      } else {
        fields.push({
          label: "Result",
          value: details.message,
          showCollapsed: true,
        });
      }

      return new ToolBody({ fields }, options, theme);
    },
  });
}
