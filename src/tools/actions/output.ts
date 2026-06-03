import { basename } from "node:path";
import { ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
  keyHint,
  truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import { Container, hyperlink, Text } from "@earendil-works/pi-tui";
import { configLoader } from "../../config";
import type { ExecuteResult, ProcessesDetails } from "../../constants";
import type { ProcessManager } from "../../manager";
import { formatStatus, hasAnsi, stripAnsi } from "../../utils";

const MAX_BYTES = 50 * 1024; // 50KB
const OUTPUT_PREVIEW_LINES = 5;

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
): Container {
  const { details } = result;

  if (!details.output) {
    const c = new OutputResultComponent();
    c.addChild(new Text(theme.fg("error", "Missing output details"), 0, 0));
    return c;
  }

  const component = new OutputResultComponent();
  rebuildOutputComponent(component, details, options, theme);
  return component;
}

class OutputResultComponent extends Container {
  state: {
    cachedWidth: number | undefined;
    cachedLines: string[] | undefined;
    cachedSkipped: number | undefined;
  } = {
    cachedWidth: undefined,
    cachedLines: undefined,
    cachedSkipped: undefined,
  };
}

function rebuildOutputComponent(
  component: OutputResultComponent,
  details: ProcessesDetails,
  options: ToolRenderResultOptions,
  theme: Theme,
): void {
  const state = component.state;
  component.clear();

  // Header line: process name, id, status, line counts
  component.addChild(new Text(theme.fg("muted", details.message), 0, 0));

  // Build styled output text (stdout then stderr)
  const outputLines: string[] = [];
  let hadAnsi = false;

  if (details.output && details.output.stdout.length > 0) {
    outputLines.push(theme.fg("accent", "stdout:"));
    for (const line of details.output.stdout) {
      if (!hadAnsi && hasAnsi(line)) hadAnsi = true;
      outputLines.push(theme.fg("toolOutput", stripAnsi(line)));
    }
  }

  if (details.output && details.output.stderr.length > 0) {
    if (outputLines.length > 0) outputLines.push("");
    outputLines.push(theme.fg("warning", "stderr:"));
    for (const line of details.output.stderr) {
      if (!hadAnsi && hasAnsi(line)) hadAnsi = true;
      outputLines.push(theme.fg("warning", stripAnsi(line)));
    }
  }

  if (outputLines.length > 0) {
    const styledOutput = outputLines.join("\n");

    if (options.expanded) {
      component.addChild(new Text(`\n${styledOutput}`, 0, 0));
    } else {
      component.addChild({
        render: (width: number) => {
          if (state.cachedLines === undefined || state.cachedWidth !== width) {
            const preview = truncateToVisualLines(
              styledOutput,
              OUTPUT_PREVIEW_LINES,
              width,
            );
            state.cachedLines = preview.visualLines;
            state.cachedSkipped = preview.skippedCount;
            state.cachedWidth = width;
          }

          if (state.cachedSkipped && state.cachedSkipped > 0) {
            const hint =
              theme.fg("muted", `... (${state.cachedSkipped} earlier lines,`) +
              ` ${keyHint("app.tools.expand", "to expand")})`;
            return ["", hint, ...(state.cachedLines ?? [])];
          }
          return ["", ...(state.cachedLines ?? [])];
        },
        invalidate: () => {
          state.cachedWidth = undefined;
          state.cachedLines = undefined;
          state.cachedSkipped = undefined;
        },
      });
    }
  }

  // Log file links
  if (details.logFiles) {
    const stdoutLink = hyperlink(
      basename(details.logFiles.stdoutFile),
      `file://${details.logFiles.stdoutFile}`,
    );
    const stderrLink = hyperlink(
      basename(details.logFiles.stderrFile),
      `file://${details.logFiles.stderrFile}`,
    );

    component.addChild(
      new Text(
        [
          "",
          theme.fg("success", "Log files:"),
          `  stdout: ${theme.fg("accent", stdoutLink)}`,
          `  stderr: ${theme.fg("accent", stderrLink)}`,
        ].join("\n"),
        0,
        0,
      ),
    );
  }

  if (hadAnsi) {
    component.addChild(
      new Text(
        `\n${theme.fg("muted", "ANSI escape codes were stripped from output")}`,
        0,
        0,
      ),
    );
  }
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
  logFiles: { stdoutFile: string; stderrFile: string } | null,
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
    result += ` Full logs: ${logFiles.stdoutFile} , ${logFiles.stderrFile}`;
  }

  result += "]";

  return result;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
