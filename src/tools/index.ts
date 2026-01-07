import { StringEnum } from "@mariozechner/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import type { ProcessInfo, ProcessManager } from "../manager";

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
        "Friendly name for the process (optional for start, e.g. 'backend-dev', 'test-runner')",
    }),
  ),
  id: Type.Optional(
    Type.String({
      description:
        "Process ID or name to match (required for output/kill/logs). Can be proc_N or friendly name.",
    }),
  ),
});

type ProcessesParamsType = Static<typeof ProcessesParams>;

interface ProcessesDetails {
  action: string;
  success: boolean;
  message: string;
  process?: ProcessInfo;
  processes?: ProcessInfo[];
  output?: { stdout: string[]; stderr: string[]; status: string };
  logFiles?: { stdoutFile: string; stderrFile: string };
  cleared?: number;
}

interface ExecuteResult {
  content: Array<{ type: "text"; text: string }>;
  details: ProcessesDetails;
}

function formatRuntime(startTime: number, endTime: number | null): string {
  const end = endTime ?? Date.now();
  const ms = end - startTime;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatStatus(proc: ProcessInfo): string {
  if (proc.status === "running") return "running";
  if (proc.status === "killed") return "killed";
  if (proc.success) return "exited(0)";
  return `exited(${proc.exitCode ?? "?"})`;
}

function truncateCmd(cmd: string, max = 40): string {
  if (cmd.length <= max) return cmd;
  return `${cmd.slice(0, max - 3)}...`;
}

export function setupProcessesTools(pi: ExtensionAPI, manager: ProcessManager) {
  pi.registerTool<typeof ProcessesParams, ProcessesDetails>({
    name: "processes",
    label: "Processes",
    description: `Manage background processes. Actions:
- start: Run command in background (requires 'command', optional 'name' for friendly display name)
- list: Show all managed processes with their IDs and names
- output: Get recent stdout/stderr (requires 'id' - can be proc_N or name match)
- logs: Get log file paths to inspect with read tool (requires 'id')
- kill: Terminate a process (requires 'id' - can be proc_N or name match like "backend")
- clear: Remove all finished processes from the list`,

    parameters: ProcessesParams,

    async execute(
      _toolCallId: string,
      params: ProcessesParamsType,
      _onUpdate: unknown,
      ctx: ExtensionContext,
      _signal?: AbortSignal,
    ): Promise<ExecuteResult> {
      switch (params.action) {
        case "start": {
          if (!params.command) {
            return {
              content: [
                { type: "text", text: "Missing required parameter: command" },
              ],
              details: {
                action: "start",
                success: false,
                message: "Missing required parameter: command",
              },
            };
          }
          const proc = manager.start(params.command, ctx.cwd, params.name);
          const message = `Started "${proc.name}" (${proc.id}, PID: ${proc.pid})\nLogs: ${proc.stdoutFile}`;
          return {
            content: [{ type: "text", text: message }],
            details: {
              action: "start",
              success: true,
              message,
              process: proc,
            },
          };
        }

        case "list": {
          const processes = manager.list();
          if (processes.length === 0) {
            return {
              content: [
                { type: "text", text: "No background processes running" },
              ],
              details: {
                action: "list",
                success: true,
                message: "No background processes running",
                processes: [],
              },
            };
          }
          const summary = processes
            .map(
              (p) =>
                `${p.id} "${p.name}": ${truncateCmd(p.command)} [${formatStatus(p)}] ${formatRuntime(p.startTime, p.endTime)}`,
            )
            .join("\n");
          const message = `${processes.length} process(es):\n${summary}`;
          return {
            content: [{ type: "text", text: message }],
            details: {
              action: "list",
              success: true,
              message,
              processes,
            },
          };
        }

        case "output": {
          if (!params.id) {
            return {
              content: [
                { type: "text", text: "Missing required parameter: id" },
              ],
              details: {
                action: "output",
                success: false,
                message: "Missing required parameter: id",
              },
            };
          }
          const proc = manager.find(params.id);
          if (!proc) {
            const message = `Process not found: ${params.id}`;
            return {
              content: [{ type: "text", text: message }],
              details: {
                action: "output",
                success: false,
                message,
              },
            };
          }
          const output = manager.getOutput(proc.id);
          if (!output) {
            const message = `Could not read output for: ${proc.id}`;
            return {
              content: [{ type: "text", text: message }],
              details: {
                action: "output",
                success: false,
                message,
              },
            };
          }
          const stdoutLines = output.stdout.length;
          const stderrLines = output.stderr.length;
          const message = `"${proc.name}" (${proc.id}) [${formatStatus(proc)}]: ${stdoutLines} stdout lines, ${stderrLines} stderr lines`;

          const outputParts: string[] = [message];
          if (output.stdout.length > 0) {
            outputParts.push("\n--- stdout (last 100 lines) ---");
            outputParts.push(...output.stdout.slice(-100));
          }
          if (output.stderr.length > 0) {
            outputParts.push("\n--- stderr (last 100 lines) ---");
            outputParts.push(...output.stderr.slice(-100));
          }

          return {
            content: [{ type: "text", text: outputParts.join("\n") }],
            details: {
              action: "output",
              success: true,
              message,
              output,
            },
          };
        }

        case "logs": {
          if (!params.id) {
            return {
              content: [
                { type: "text", text: "Missing required parameter: id" },
              ],
              details: {
                action: "logs",
                success: false,
                message: "Missing required parameter: id",
              },
            };
          }
          const proc = manager.find(params.id);
          if (!proc) {
            const message = `Process not found: ${params.id}`;
            return {
              content: [{ type: "text", text: message }],
              details: {
                action: "logs",
                success: false,
                message,
              },
            };
          }
          const logFiles = manager.getLogFiles(proc.id);
          if (!logFiles) {
            const message = `Could not get log files for: ${proc.id}`;
            return {
              content: [{ type: "text", text: message }],
              details: {
                action: "logs",
                success: false,
                message,
              },
            };
          }
          const message = `Log files for "${proc.name}" (${proc.id}):\n  stdout: ${logFiles.stdoutFile}\n  stderr: ${logFiles.stderrFile}\n\nUse the read tool to inspect these files.`;
          return {
            content: [{ type: "text", text: message }],
            details: {
              action: "logs",
              success: true,
              message,
              logFiles,
            },
          };
        }

        case "kill": {
          if (!params.id) {
            return {
              content: [
                { type: "text", text: "Missing required parameter: id" },
              ],
              details: {
                action: "kill",
                success: false,
                message: "Missing required parameter: id",
              },
            };
          }
          const proc = manager.find(params.id);
          if (!proc) {
            const message = `Process not found: ${params.id}`;
            return {
              content: [{ type: "text", text: message }],
              details: {
                action: "kill",
                success: false,
                message,
              },
            };
          }
          const killed = manager.kill(proc.id);
          if (killed) {
            const message = `Killed "${proc.name}" (${proc.id})`;
            return {
              content: [{ type: "text", text: message }],
              details: {
                action: "kill",
                success: true,
                message,
              },
            };
          }
          const message = `Failed to kill "${proc.name}" (${proc.id})`;
          return {
            content: [{ type: "text", text: message }],
            details: {
              action: "kill",
              success: false,
              message,
            },
          };
        }

        case "clear": {
          const cleared = manager.clearFinished();
          const message =
            cleared > 0
              ? `Cleared ${cleared} finished process(es)`
              : "No finished processes to clear";
          return {
            content: [{ type: "text", text: message }],
            details: {
              action: "clear",
              success: true,
              message,
              cleared,
            },
          };
        }

        default:
          return {
            content: [
              { type: "text", text: `Unknown action: ${params.action}` },
            ],
            details: {
              action: params.action,
              success: false,
              message: `Unknown action: ${params.action}`,
            },
          };
      }
    },

    renderCall(args: ProcessesParamsType, theme: Theme): Text {
      let text = theme.fg("toolTitle", theme.bold("processes "));
      text += theme.fg("accent", args.action);

      switch (args.action) {
        case "start":
          if (args.name) {
            text += ` ${theme.fg("accent", `"${args.name}"`)}`;
          }
          if (args.command) {
            text += ` ${theme.fg("muted", args.command.slice(0, 40))}`;
          }
          break;
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

        if (details.output.stdout.length > 0) {
          lines.push("");
          lines.push(theme.fg("accent", "stdout:"));
          const stdoutLines = details.output.stdout.slice(-20);
          for (const line of stdoutLines) {
            lines.push(line);
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
            lines.push(theme.fg("warning", line));
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
          const status =
            p.status === "running"
              ? theme.fg("accent", "running")
              : p.success
                ? theme.fg("success", "exit(0)")
                : theme.fg("error", `exit(${p.exitCode})`);
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
