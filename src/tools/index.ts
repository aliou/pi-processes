import { ToolBody, ToolCallHeader, ToolFooter } from "@aliou/pi-utils-ui";
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
import { formatRuntime, hasAnsi, stripAnsi, truncateCmd } from "../utils";
import { executeAction } from "./actions";

const ProcessesParams = Type.Object({
  action: StringEnum(
    ["start", "list", "output", "logs", "kill", "clear", "write"] as const,
    {
      description:
        "Action: start (run command), list (show all), output (get recent output), logs (get log file paths), kill (terminate), clear (remove finished), write (write to stdin)",
    },
  ),
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
        "Process ID or name to match (required for output/kill/logs/write). Can be proc_N or friendly name.",
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
- list: Show all managed processes with their IDs and names
- output: Get recent stdout/stderr (requires 'id' - can be proc_N or name match)
- logs: Get log file paths to inspect with read tool (requires 'id')
- kill: Terminate a process (requires 'id' - can be proc_N or name match like "backend")
- clear: Remove all finished processes from the list
- write: Write to process stdin (requires 'id' and 'input', optional 'end' to close stdin)

Important: You DON'T need to poll or wait for processes. Notifications arrive automatically based on your preferences. Start processes and continue with other work - you'll be informed if something requires attention.

Note: User always sees process updates in the UI. The notify flags control whether YOU (the agent) get a turn to react (e.g. check results, fix code, restart).`,

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
        const text = result.content[0];
        return new Text(
          text?.type === "text" && text.text ? text.text : "No result",
          0,
          0,
        );
      }

      const fields: Array<
        { label: string; value: string; showCollapsed?: boolean } | Text
      > = [];

      if (!details.success) {
        fields.push({
          label: "Error",
          value: theme.fg("error", details.message),
          showCollapsed: true,
        });
      } else if (details.action === "start" && details.process) {
        const process = details.process;
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

        if (hadAnsi) {
          lines.push(
            "",
            theme.fg("muted", "ANSI escape codes were stripped from output"),
          );
        }

        fields.push(new Text(lines.join("\n"), 0, 0));
      } else if (
        details.action === "list" &&
        details.processes &&
        details.processes.length > 0
      ) {
        const lines: string[] = [
          theme.fg("success", `${details.processes.length} process(es):`),
        ];

        for (const process of details.processes) {
          let status: string;
          switch (process.status) {
            case "running":
              status = theme.fg("accent", "running");
              break;
            case "terminating":
              status = theme.fg("warning", "terminating");
              break;
            case "terminate_timeout":
              status = theme.fg("error", "terminate_timeout");
              break;
            case "killed":
              status = theme.fg("warning", "killed");
              break;
            case "exited":
              status = process.success
                ? theme.fg("success", "exit(0)")
                : theme.fg("error", `exit(${process.exitCode ?? "?"})`);
              break;
            default:
              status = theme.fg("muted", process.status);
          }

          lines.push(
            `  ${process.id} ${theme.fg("accent", `"${process.name}"`)}: ${truncateCmd(process.command)} [${status}] ${formatRuntime(process.startTime, process.endTime)}`,
          );
        }

        fields.push(new Text(lines.join("\n"), 0, 0));
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

      const footer = new ToolFooter(theme, {
        items: [
          { label: "action", value: details.action, tone: "accent" },
          {
            label: "status",
            value: details.success ? "ok" : "error",
            tone: details.success ? "success" : "error",
          },
        ],
      });

      return new ToolBody({ fields, footer }, options, theme);
    },
  });
}
