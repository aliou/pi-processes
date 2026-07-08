import type { ProcessManager } from "../../../../src/manager";
import { stripAnsi } from "../../../../src/utils";
import type { LineMatchMode } from "../../../../src/utils/match-line";
import { compileLineMatcher } from "../../../../src/utils/match-line";
import type { ProcessesParamsType } from "../schema";
import {
  DEFAULT_OUTPUT_TAIL_LINES,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_SCAN_LINES,
  MAX_OUTPUT_TAIL_LINES,
  type ProcessOutputMatchMode,
  type ProcessOutputStream,
} from "../schema";

export interface OutputDetails {
  action: "output";
  id: string;
  processName: string;
  processStatus: string;
  stream: ProcessOutputStream;
  tailLines: number;
  pattern: string | null;
  mode: ProcessOutputMatchMode;
  stdout: string[];
  stderr: string[];
  stdoutFile: string;
  stderrFile: string;
}

export function executeOutput(
  params: ProcessesParamsType,
  manager: ProcessManager,
): OutputDetails {
  if (!params.id) {
    throw new Error("process output requires id");
  }

  const process = manager.get(params.id);
  if (!process) {
    throw new Error(`process not found: ${params.id}`);
  }

  const stream = params.stream ?? "both";
  const tailLines = clampTailLines(params.tailLines);
  const mode = (params.mode ?? "literal") as LineMatchMode;
  const pattern = params.pattern ?? null;

  if (pattern && mode === "regex") {
    validateRegex(pattern);
  }

  // Determine scan window: if filtering by pattern, read a larger bounded
  // window so we can find matches beyond the narrow tail.
  const scanLines = pattern ? MAX_OUTPUT_SCAN_LINES : tailLines;

  const output = manager.getOutput(process.id, scanLines);
  if (!output) {
    throw new Error(
      `could not read output for "${process.name}" (${process.id})`,
    );
  }

  // Apply stream filter
  let stdout = stream === "stderr" ? [] : output.stdout;
  let stderr = stream === "stdout" ? [] : output.stderr;

  // Apply pattern filter (filter first, then tail)
  if (pattern) {
    const lineMatcher = compileLineMatcher(pattern, mode);
    stdout = stdout.filter(lineMatcher);
    stderr = stderr.filter(lineMatcher);
  }

  // Tail to requested line count
  stdout = stdout.slice(-tailLines);
  stderr = stderr.slice(-tailLines);

  return {
    action: "output",
    id: process.id,
    processName: process.name,
    processStatus: output.status,
    stream,
    tailLines,
    pattern,
    mode,
    stdout,
    stderr,
    stdoutFile: process.stdoutFile,
    stderrFile: process.stderrFile,
  };
}

export function formatOutputDetails(details: OutputDetails): string {
  const parts: string[] = [];

  parts.push(
    `"${details.processName}" (${details.id}) [${details.processStatus}]`,
  );

  if (details.pattern) {
    const modeTag = details.mode === "regex" ? " (regex)" : "";
    parts.push(`filter: ${details.pattern}${modeTag}`);
  }

  if (details.stdout.length > 0) {
    parts.push("", "stdout:");
    parts.push(...details.stdout.map(stripAnsi));
  }

  if (details.stderr.length > 0) {
    parts.push("", "stderr:");
    parts.push(...details.stderr.map(stripAnsi));
  }

  if (details.stdout.length === 0 && details.stderr.length === 0) {
    if (details.pattern) {
      parts.push("", "No matching lines found.");
    } else {
      parts.push("", "No output yet.");
    }
  }

  if (details.processStatus === "running") {
    parts.push("", "Process is still running. Use watches instead of polling.");
  }

  const fullText = parts.join("\n");
  return truncateOutputText(fullText, {
    stdoutFile: details.stdoutFile,
    stderrFile: details.stderrFile,
  });
}

/**
 * Truncate output text from the tail (keep the last N lines / bytes).
 * When truncated, appends a notice pointing to the log files.
 */
function truncateOutputText(
  text: string,
  logFiles: { stdoutFile: string; stderrFile: string },
): string {
  const totalBytes = Buffer.byteLength(text, "utf-8");
  const lines = text.split("\n");
  const totalLines = lines.length;

  if (totalLines <= MAX_OUTPUT_TAIL_LINES && totalBytes <= MAX_OUTPUT_BYTES) {
    return text;
  }

  // Work backwards, collecting lines that fit
  const kept: string[] = [];
  let keptBytes = 0;
  let hitBytes = false;

  for (
    let i = lines.length - 1;
    i >= 0 && kept.length < MAX_OUTPUT_TAIL_LINES;
    i--
  ) {
    const line = lines[i] ?? "";
    const lineBytes =
      Buffer.byteLength(line, "utf-8") + (kept.length > 0 ? 1 : 0);

    if (keptBytes + lineBytes > MAX_OUTPUT_BYTES) {
      hitBytes = true;
      break;
    }

    kept.unshift(line);
    keptBytes += lineBytes;
  }

  let result = kept.join("\n");

  const shownLines = kept.length;
  const startLine = totalLines - shownLines + 1;
  const sizeNote = hitBytes ? ` (${formatSize(MAX_OUTPUT_BYTES)} limit)` : "";
  result += `\n\n[Showing lines ${startLine}-${totalLines} of ${totalLines}${sizeNote}.`;
  result += ` Full logs: ${logFiles.stdoutFile} , ${logFiles.stderrFile}`;
  result += "]";

  return result;
}

function clampTailLines(value: number | undefined): number {
  if (value === undefined || value === null) return DEFAULT_OUTPUT_TAIL_LINES;
  const n = Math.floor(value);
  if (n < 1) return DEFAULT_OUTPUT_TAIL_LINES;
  if (n > MAX_OUTPUT_TAIL_LINES) return MAX_OUTPUT_TAIL_LINES;
  return n;
}

function validateRegex(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `process output pattern is not a valid regular expression: ${message}`,
    );
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
