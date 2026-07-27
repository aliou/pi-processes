import {
  formatSize,
  type TruncationResult,
  truncateTail,
} from "@earendil-works/pi-coding-agent";

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

const MAX_OUTPUT_CONTENT_JSON_BYTES = 96 * 1024;
const MAX_OUTPUT_PROCESS_NAME_BYTES = 256;

export interface OutputDetails {
  action: "output";
  id: string;
  processName: string;
  processStatus: string;
  stream: ProcessOutputStream;
  tailLines: number;
  pattern: string | null;
  mode: ProcessOutputMatchMode;
  stdoutFile: string;
  stderrFile: string;
  truncation?: OutputTruncationDetails;
}

export type OutputTruncationDetails = Omit<TruncationResult, "content">;

interface OutputSelection {
  stdout: string[];
  stderr: string[];
}

export interface OutputExecutionResult {
  content: string;
  details: OutputDetails;
}

export function executeOutput(
  params: ProcessesParamsType,
  manager: ProcessManager,
): OutputExecutionResult {
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
  let stdout: string[] = stream === "stderr" ? [] : output.stdout;
  let stderr: string[] = stream === "stdout" ? [] : output.stderr;

  // Apply pattern filter (filter first, then tail)
  if (pattern) {
    const lineMatcher = compileLineMatcher(pattern, mode);
    stdout = stdout.filter(lineMatcher);
    stderr = stderr.filter(lineMatcher);
  }

  // Tail to requested line count
  stdout = stdout.slice(-tailLines);
  stderr = stderr.slice(-tailLines);

  const selection: OutputSelection = { stdout, stderr };
  const processName = formatProcessName(process.name);

  const contentParts = formatOutputContent({
    processName,
    id: process.id,
    processStatus: output.status,
    stream,
    tailLines,
    pattern,
    mode,
    ...selection,
  });

  const { content, truncation } = buildBoundedOutput(contentParts, {
    stdoutFile: process.stdoutFile,
    stderrFile: process.stderrFile,
  });

  const details: OutputDetails = {
    action: "output",
    id: process.id,
    processName,
    processStatus: output.status,
    stream,
    tailLines,
    pattern,
    mode,
    stdoutFile: process.stdoutFile,
    stderrFile: process.stderrFile,
  };

  if (truncation.truncated) {
    const { content: _content, ...truncationDetails } = truncation;
    details.truncation = truncationDetails;
  }

  return { content, details };
}

interface OutputContentInput extends OutputSelection {
  processName: string;
  id: string;
  processStatus: string;
  stream: ProcessOutputStream;
  tailLines: number;
  pattern: string | null;
  mode: ProcessOutputMatchMode;
}

interface OutputContentParts {
  header: string;
  body: string;
  guidance: string | null;
}

function formatOutputContent(input: OutputContentInput): OutputContentParts {
  const header: string[] = [];
  header.push(`"${input.processName}" (${input.id}) [${input.processStatus}]`);

  if (input.pattern) {
    const modeTag = input.mode === "regex" ? " (regex)" : "";
    header.push(`filter: ${input.pattern}${modeTag}`);
  }

  const body: string[] = [];
  const { stdout, stderr } = input;

  if (stdout.length > 0) {
    body.push("stdout:");
    body.push(...stdout.map(stripAnsi));
  }

  if (stderr.length > 0) {
    if (body.length > 0) body.push("");
    body.push("stderr:");
    body.push(...stderr.map(stripAnsi));
  }

  if (stdout.length === 0 && stderr.length === 0) {
    body.push(input.pattern ? "No matching lines found." : "No output yet.");
  }

  return {
    header: header.join("\n"),
    body: body.join("\n"),
    guidance:
      input.processStatus === "running"
        ? "Process is still running. Use watches instead of polling."
        : null,
  };
}

function buildBoundedOutput(
  parts: OutputContentParts,
  logFiles: { stdoutFile: string; stderrFile: string },
): { content: string; truncation: TruncationResult } {
  let maxBodyBytes = MAX_OUTPUT_BYTES;
  let maxBodyLines = MAX_OUTPUT_TAIL_LINES;
  let truncation = truncateTail(parts.body, {
    maxBytes: maxBodyBytes,
    maxLines: maxBodyLines,
  });
  let content = composeOutputContent(parts, truncation, logFiles);

  // The header, guidance, truncation notice, and log paths are part of the
  // persisted content limit. JSON escaping can expand control characters, so
  // keep the serialized content bounded too. Reduce the body budget until the
  // complete result fits while keeping the newest output.
  for (let attempt = 0; attempt < 10; attempt++) {
    const excessBytes = Buffer.byteLength(content, "utf8") - MAX_OUTPUT_BYTES;
    const excessLines = countLines(content) - MAX_OUTPUT_TAIL_LINES;
    const excessJsonBytes =
      Buffer.byteLength(JSON.stringify(content), "utf8") -
      MAX_OUTPUT_CONTENT_JSON_BYTES;
    if (excessBytes <= 0 && excessLines <= 0 && excessJsonBytes <= 0) {
      return { content, truncation };
    }

    maxBodyBytes = Math.max(0, maxBodyBytes - Math.max(0, excessBytes));
    if (excessJsonBytes > 0) {
      maxBodyBytes = Math.floor(maxBodyBytes / 2);
    }
    maxBodyLines = Math.max(1, maxBodyLines - Math.max(0, excessLines));
    truncation = truncateTail(parts.body, {
      maxBytes: maxBodyBytes,
      maxLines: maxBodyLines,
    });
    content = composeOutputContent(parts, truncation, logFiles);
  }

  // Pathological metadata can consume the whole budget. Keep the final tail,
  // which contains the truncation notice and complete-log paths, bounded.
  const finalTruncation = truncateTail(content, {
    maxBytes: MAX_OUTPUT_BYTES,
    maxLines: MAX_OUTPUT_TAIL_LINES,
  });
  return { content: finalTruncation.content, truncation };
}

function composeOutputContent(
  parts: OutputContentParts,
  truncation: TruncationResult,
  logFiles: { stdoutFile: string; stderrFile: string },
): string {
  const sections = [parts.header, truncation.content];

  if (parts.guidance) {
    sections.push(parts.guidance);
  }

  if (truncation.truncated) {
    sections.push(formatTruncationNotice(truncation));
  }

  sections.push(
    `[Complete currently-retained logs:\nstdout=${logFiles.stdoutFile}\nstderr=${logFiles.stderrFile}]`,
  );
  return sections.filter((section) => section.length > 0).join("\n\n");
}

function formatTruncationNotice(truncation: TruncationResult): string {
  const limit =
    truncation.truncatedBy === "bytes"
      ? `${formatSize(truncation.maxBytes)} byte limit`
      : `${truncation.maxLines} line limit`;
  const partialNote = truncation.lastLinePartial
    ? " (final line is a partial suffix)"
    : "";
  return `[Preview truncated by ${limit}${partialNote}; showing ${truncation.outputLines} lines / ${formatSize(truncation.outputBytes)} of ${truncation.totalLines} lines / ${formatSize(truncation.totalBytes)}.]`;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function formatProcessName(name: string): string {
  const clean = stripAnsi(name).replace(/\s+/gu, " ").trim() || "(unnamed)";
  if (Buffer.byteLength(clean, "utf8") <= MAX_OUTPUT_PROCESS_NAME_BYTES) {
    return clean;
  }

  const suffix = "…";
  const buffer = Buffer.from(clean, "utf8");
  let end = MAX_OUTPUT_PROCESS_NAME_BYTES - Buffer.byteLength(suffix, "utf8");
  while (end > 0 && (buffer[end] ?? 0) >> 6 === 0b10) {
    end--;
  }
  return `${buffer.subarray(0, end).toString("utf8")}${suffix}`;
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
