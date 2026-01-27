import type { ExecuteResult } from "../../constants";
import type { ProcessManager } from "../../manager";
import { formatStatus, stripAnsi } from "../../utils";

const MAX_LINES = 200;
const MAX_BYTES = 50 * 1024; // 50KB

interface OutputParams {
  id?: string;
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
  const contentText = truncateTail(fullText, logFiles);

  return {
    content: [{ type: "text", text: contentText }],
    details: {
      action: "output",
      success: true,
      message,
      output,
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
): string {
  const totalBytes = Buffer.byteLength(text, "utf-8");
  const lines = text.split("\n");
  const totalLines = lines.length;

  if (totalLines <= MAX_LINES && totalBytes <= MAX_BYTES) {
    return text;
  }

  // Work backwards, collecting lines that fit
  const kept: string[] = [];
  let keptBytes = 0;
  let hitBytes = false;

  for (let i = lines.length - 1; i >= 0 && kept.length < MAX_LINES; i--) {
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
