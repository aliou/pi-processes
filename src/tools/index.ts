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
    ["start", "list", "output", "logs", "kill", "clear"] as const,
    {
      description:
        "Action: start (run command), list (show all), output (get recent output), logs (get log file paths), kill (terminate), clear (remove finished)",
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
        "Process ID or name to match (required for output/kill/logs). Can be proc_N or friendly name.",
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

Important: You DON'T need to poll or wait for processes. Notifications arrive automatically based on your preferences. Start processes and continue with other work - you'll be informed if something requires attention.

Note: User always sees process updates in the UI. The notify flags control whether YOU (the agent) get a turn to react (e.g. check results, fix code, restart).`,

    parameters: ProcessesParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeAction(params, manager, ctx);
    },

    renderCall(args: ProcessesParamsType, theme: Theme): Text {
      let text = theme.fg("toolTitle", theme.bold("Process "));
      text += theme.fg("accent", args.action);

      switch (args.action) {
        case "start": {
          if (args.name) {
            text += ` ${theme.fg("accent", `"${args.name}"`)}`;
          }
          if (args.command) {
            text += `\n${theme.fg("muted", `$ ${args.command}`)}`;
          }
          return new Text(text, 0, 0);
        }
        case "output":
        case "kill":
        case "logs":
          if (args.id) {
            text += ` ${theme.fg("muted", args.id)}`;
          }
          break;
      }

      return new Text(text, 0, 0);
    },

    renderResult(
      result: AgentToolResult<ProcessesDetails>,
      _options: ToolRenderResultOptions,
      theme: Theme,
    ): Text {
      const { details } = result;

      if (!details) {
        const text = result.content[0];
        return new Text(
          text?.type === "text" && text.text ? text.text : "No result",
          0,
          0,
        );
      }

      if (!details.success) {
        return new Text(theme.fg("error", details.message), 0, 0);
      }

      // For start action
      if (details.action === "start" && details.process) {
        const p = details.process;
        return new Text(
          theme.fg("success", "\u2713 Started ") +
            theme.fg("accent", `"${p.name}"`) +
            ` (${p.id}, PID: ${p.pid})`,
          0,
          0,
        );
      }

      // For output action
      if (details.action === "output" && details.output) {
        const lines: string[] = [];
        lines.push(theme.fg("muted", details.message));

        let hadAnsi = false;

        if (details.output.stdout.length > 0) {
          lines.push("");
          lines.push(theme.fg("accent", "stdout:"));
          const stdoutLines = details.output.stdout.slice(-20);
          for (const line of stdoutLines) {
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
          lines.push("");
          lines.push(theme.fg("warning", "stderr:"));
          const stderrLines = details.output.stderr.slice(-10);
          for (const line of stderrLines) {
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
          lines.push("");
          lines.push(
            theme.fg("muted", "ANSI escape codes were stripped from output"),
          );
        }

        return new Text(lines.join("\n"), 0, 0);
      }

      // For list action
      if (
        details.action === "list" &&
        details.processes &&
        details.processes.length > 0
      ) {
        const lines: string[] = [];
        lines.push(
          theme.fg("success", `${details.processes.length} process(es):`),
        );
        for (const p of details.processes) {
          let status: string;
          switch (p.status) {
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
              status = p.success
                ? theme.fg("success", "exit(0)")
                : theme.fg("error", `exit(${p.exitCode ?? "?"})`);
              break;
            default:
              status = theme.fg("muted", p.status);
          }
          lines.push(
            `  ${p.id} ${theme.fg("accent", `"${p.name}"`)}: ${truncateCmd(p.command)} [${status}] ${formatRuntime(p.startTime, p.endTime)}`,
          );
        }
        return new Text(lines.join("\n"), 0, 0);
      }

      // For logs action
      if (details.action === "logs" && details.logFiles) {
        const lines: string[] = [];
        lines.push(theme.fg("success", "Log files:"));
        lines.push(
          `  stdout: ${theme.fg("accent", details.logFiles.stdoutFile)}`,
        );
        lines.push(
          `  stderr: ${theme.fg("accent", details.logFiles.stderrFile)}`,
        );
        return new Text(lines.join("\n"), 0, 0);
      }

      // For clear action
      if (details.action === "clear") {
        return new Text(
          theme.fg("success", "\u2713 ") + theme.fg("muted", details.message),
          0,
          0,
        );
      }

      return new Text(details.message, 0, 0);
    },
  });
}
