import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { configLoader } from "../../config";
import type { ExecuteResult, ProcessesDetails } from "../../constants";
import type { ProcessManager } from "../../manager";
import { formatStatus, hasAnsi, stripAnsi } from "../../utils";

const MAX_BYTES = 50 * 1024; // 50KB

interface OutputParams {
  id?: string;
}

export function renderOutputCall(
  args: OutputParams,
  theme: Theme,
): ToolCallHeader {
  return new ToolCallHeader(
    {
      toolName: "Process",
      action: "output",
      mainArg: args.id,
    },
    theme,
  );
}

export function renderOutputResult(
  result: AgentToolResult<ProcessesDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
): ToolBody {
  const { details } = result;

  if (!details.output) {
    return new ToolBody(
      {
        fields: [
          {
            label: "Error",
            value: "Missing output details",
            showCollapsed: true,
          },
        ],
      },
      options,
      theme,
    );
  }

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
      `  combined: ${theme.fg("accent", details.logFiles.combinedFile)}`,
    );
  }

  if (hadAnsi) {
    lines.push(
      "",
      theme.fg("muted", "ANSI escape codes were stripped from output"),
    );
  }

  const fields: Array<
    { label: string; value: string; showCollapsed?: boolean } | Text
  > = [new Text(lines.join("\n"), 0, 0)];

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

  return new ToolBody({ fields }, options, theme);
}

export function executeOutput(
  params: OutputParams,
  manager: ProcessManager,
): ExecuteResult {
  if (!params.id) {
    return {
      content: [{ type: "text", text: "Missing required parameter: id" }],
      details: {
        action: "output",
        success: false,
        message: "Missing required parameter: id",
      },
    };
  }

  const proc = manager.get(params.id);
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

  const { defaultTailLines } = configLoader.getConfig().output;
  const output = manager.getOutput(proc.id, defaultTailLines);
  if (!output) {
    const message = `Could not read output for "${proc.name}" (${proc.id})`;
    return {
      content: [{ type: "text", text: message }],
      details: {
        action: "output",
        success: false,
        message,
      },
    };
  }

  const logFiles = manager.getLogFiles(proc.id);
  const stdoutLines = output.stdout.length;
  const stderrLines = output.stderr.length;
  const message = `"${proc.name}" (${proc.id}) [${formatStatus(proc)}]: ${stdoutLines} stdout lines, ${stderrLines} stderr lines`;

  // Build the full text content (ANSI-stripped), then truncate from the tail
  // like bash does, so the agent sees the most recent output.
  const outputParts: string[] = [message];
  if (output.status === "running") {
    outputParts.push(
      "Process is still running. Use output for targeted inspection only; if you are waiting for a marker, update logWatches instead of polling.",
    );
  }
  if (output.stdout.length > 0) {
    outputParts.push("\nstdout:");
    outputParts.push(...output.stdout.map(stripAnsi));
  }
  if (output.stderr.length > 0) {
    outputParts.push("\nstderr:");
    outputParts.push(...output.stderr.map(stripAnsi));
  }

  const fullText = outputParts.join("\n");
  const { maxOutputLines } = configLoader.getConfig().output;
  const contentText = truncateTail(fullText, logFiles, maxOutputLines);

  return {
    content: [{ type: "text", text: contentText }],
    details: {
      action: "output",
      success: true,
      message,
      output,
      logFiles: logFiles
        ? {
            stdoutFile: logFiles.stdoutFile,
            stderrFile: logFiles.stderrFile,
            combinedFile: logFiles.combinedFile,
          }
        : undefined,
    },
  };
}

/**
 * Truncate text from the tail (keep last N lines / MAX_BYTES), matching
 * the behaviour of pi's built-in bash tool.  When truncated, appends a
 * notice pointing the agent to the full log files.
 */
function truncateTail(
  text: string,
  logFiles: {
    stdoutFile: string;
    stderrFile: string;
    combinedFile: string;
  } | null,
  maxLines: number,
): string {
  const totalBytes = Buffer.byteLength(text, "utf-8");
  const lines = text.split("\n");
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= MAX_BYTES) {
    return text;
  }

  // Work backwards, collecting lines that fit
  const kept: string[] = [];
  let keptBytes = 0;
  let hitBytes = false;

  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i] ?? "";
    const lineBytes =
      Buffer.byteLength(line, "utf-8") + (kept.length > 0 ? 1 : 0);

    if (keptBytes + lineBytes > MAX_BYTES) {
      hitBytes = true;
      break;
    }

    kept.unshift(line);
    keptBytes += lineBytes;
  }

  let result = kept.join("\n");

  // Append a notice so the agent knows output was truncated
  const shownLines = kept.length;
  const startLine = totalLines - shownLines + 1;
  const sizeNote = hitBytes ? ` (${formatSize(MAX_BYTES)} limit)` : "";
  result += `\n\n[Showing lines ${startLine}-${totalLines} of ${totalLines}${sizeNote}.`;

  if (logFiles) {
    result += ` Full logs: ${logFiles.stdoutFile} , ${logFiles.stderrFile} , ${logFiles.combinedFile}`;
  }

  result += "]";

  return result;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
