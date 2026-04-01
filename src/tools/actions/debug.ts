import { ToolCallHeader } from "@aliou/pi-utils-ui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ExecuteResult, ProcessInfo } from "../../constants";

interface DebugParams {
  preview?: "start" | "list" | "output" | "logs" | "error";
}

export function renderDebugCall(
  args: DebugParams,
  theme: Theme,
): ToolCallHeader {
  return new ToolCallHeader(
    {
      toolName: "Process",
      action: "debug_preview",
      mainArg: args.preview,
    },
    theme,
  );
}

function mockProcess(overrides?: Partial<ProcessInfo>): ProcessInfo {
  const now = Date.now();
  return {
    id: "proc_42",
    name: "demo-server",
    pid: 4242,
    command: "pnpm dev --port 3000",
    cwd: "/tmp/demo",
    startTime: now - 12_000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/pi-processes-demo/proc_42-stdout.log",
    stderrFile: "/tmp/pi-processes-demo/proc_42-stderr.log",
    alertOnSuccess: false,
    alertOnFailure: true,
    alertOnKill: false,
    ...overrides,
  };
}

/**
 * Temporary no-side-effect previews for process tool renderers.
 * Remove before release.
 */
export function executeDebugPreview(params: DebugParams): ExecuteResult {
  const preview = params.preview ?? "start";

  if (preview === "start") {
    const process = mockProcess();
    const message = [
      `Started "${process.name}" (${process.id}, PID: ${process.pid})`,
      "Log files:",
      `  stdout: ${process.stdoutFile}`,
      `  stderr: ${process.stderrFile}`,
    ].join("\n");
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "start",
        success: true,
        message,
        process,
      },
    };
  }

  if (preview === "list") {
    const processes = [
      mockProcess(),
      mockProcess({
        id: "proc_11",
        name: "builder",
        pid: 1011,
        command: "pnpm build --watch",
      }),
      mockProcess({
        id: "proc_10",
        name: "tests",
        pid: 1010,
        command: "pnpm test",
        status: "exited",
        success: false,
        endTime: Date.now() - 3_000,
        exitCode: 1,
      }),
    ];

    return {
      content: [{ type: "text", text: "Debug preview: list" }],
      details: {
        action: "list",
        success: true,
        message: "Debug preview: list",
        processes,
      },
    };
  }

  if (preview === "output") {
    return {
      content: [{ type: "text", text: "Debug preview: output" }],
      details: {
        action: "output",
        success: true,
        message:
          '"demo-server" (proc_42) [running]: 4 stdout lines, 2 stderr lines',
        output: {
          status: "running",
          stdout: [
            "starting...",
            "loading config",
            "ready on http://localhost:3000",
            "watching for changes",
          ],
          stderr: [
            "warn: deprecated option in config",
            "error: simulated stack trace line",
          ],
        },
        logFiles: {
          stdoutFile: "/tmp/pi-processes-demo/proc_42-stdout.log",
          stderrFile: "/tmp/pi-processes-demo/proc_42-stderr.log",
        },
      },
    };
  }

  if (preview === "logs") {
    return {
      content: [{ type: "text", text: "Debug preview: logs" }],
      details: {
        action: "logs",
        success: true,
        message: "Debug preview: logs",
        logFiles: {
          stdoutFile: "/tmp/pi-processes-demo/proc_42-stdout.log",
          stderrFile: "/tmp/pi-processes-demo/proc_42-stderr.log",
        },
      },
    };
  }

  throw new Error("Invalid logWatches[0].pattern: Unterminated group");
}
