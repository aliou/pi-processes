import { ToolBody, ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { configLoader } from "../../config";
import type { ExecuteResult, ProcessesDetails } from "../../constants";
import type { ProcessManager } from "../../manager";
import { formatStatus, hasAnsi, stripAnsi } from "../../utils";
import {
  countLines,
  formatTruncationNotice,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_JSON_BYTES,
  type TruncationDetails,
  type TruncationResult,
  truncateTail,
} from "./output-truncate";

interface OutputParams {
  id?: string;
}

/** Marker delimiting the always-present complete-log footer in content. */
const LOG_FOOTER_MARKER = "[Complete currently-retained logs:";

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
  const { details, content } = result;

  const textBlock = Array.isArray(content)
    ? content.find((block) => block.type === "text")
    : undefined;
  const contentText =
    textBlock && textBlock.type === "text" ? textBlock.text : "";

  // Legacy session results still carry raw stdout/stderr arrays in details.
  // Render them so historical entries remain visible without errors.
  if (details.output) {
    return renderLegacyOutput(details, theme, options);
  }

  const bodyLines = extractOutputBody(contentText, details);
  let hadAnsi = false;

  const lines: string[] = [theme.fg("muted", details.message)];

  if (bodyLines.length > 0) {
    lines.push("");
    for (const line of bodyLines) {
      if (!hadAnsi && hasAnsi(line)) hadAnsi = true;
      lines.push(line);
    }
  } else {
    lines.push("", theme.fg("muted", "(no output)"));
  }

  if (details.truncation) {
    lines.push(
      "",
      theme.fg("muted", buildTruncationSummary(details.truncation)),
    );
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

  const fields: Array<
    { label: string; value: string; showCollapsed?: boolean } | Text
  > = [new Text(lines.join("\n"), 0, 0)];

  // Collapsed preview: the last couple of body lines.
  const preview =
    bodyLines.slice(-2).join("\n") || theme.fg("muted", "(empty)");
  fields.push({
    label: "Output",
    value: theme.fg("muted", preview),
    showCollapsed: true,
  });

  return new ToolBody({ fields }, options, theme);
}

function renderLegacyOutput(
  details: ProcessesDetails,
  theme: Theme,
  options: ToolRenderResultOptions,
): ToolBody {
  const lines: string[] = [theme.fg("muted", details.message)];
  let hadAnsi = false;

  if (details.output?.stdout.length) {
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

  if (details.output?.stderr.length) {
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

  const previewSource = details.output?.stdout.length
    ? details.output.stdout
    : (details.output?.stderr ?? []);
  const preview = previewSource
    .slice(-2)
    .map((l) => stripAnsi(l))
    .join("\n");

  const fields: Array<
    { label: string; value: string; showCollapsed?: boolean } | Text
  > = [
    new Text(lines.join("\n"), 0, 0),
    {
      label: "Output",
      value: preview
        ? theme.fg("muted", preview)
        : theme.fg("muted", "(empty)"),
      showCollapsed: true,
    },
  ];

  return new ToolBody({ fields }, options, theme);
}

/**
 * Extract the bounded process-output body from tool-result content text.
 *
 * Content is structured as:
 *   - a one-line header (`details.message`);
 *   - the bounded output body (already ANSI-stripped);
 *   - an optional truncation notice line;
 *   - an always-present complete-log footer.
 *
 * Only the body is returned. The renderer uses `details` for metadata,
 * truncation state, and log paths; this function never re-parses stream
 * labels, so a real log line containing `stderr:` cannot confuse it.
 *
 * Legacy content that lost its header through tail truncation is accepted: if
 * the first line does not match the expected header, the whole content is
 * treated as body up to the footer.
 */
function extractOutputBody(
  contentText: string,
  details: ProcessesDetails,
): string[] {
  if (!contentText) return [];

  const lines = contentText.split("\n");
  const header = details.message;

  let bodyStart = lines[0] === header ? 1 : 0;
  // Skip the blank separator following the header.
  if (bodyStart > 0 && lines[bodyStart] === "") {
    bodyStart++;
  }

  const footerStart = findLastLineIndex(
    lines,
    (line) => line === LOG_FOOTER_MARKER,
  );
  let bodyEnd = footerStart >= 0 ? footerStart : lines.length;

  // Exclude the running-guidance line, which sits between the body and the
  // footer/notice. It is metadata, not process output.
  const guidance = "Process is still running. Use watches instead of polling.";
  const guidanceIndex = findLastLineIndex(
    lines,
    (line, index) => index < bodyEnd && line === guidance,
  );
  if (guidanceIndex >= bodyStart) {
    bodyEnd = guidanceIndex;
  }

  // Exclude a preceding blank line that separated body from the footer/notice.
  while (bodyEnd > bodyStart && (lines[bodyEnd - 1] ?? "") === "") {
    bodyEnd--;
  }

  return lines.slice(bodyStart, bodyEnd);
}

function buildTruncationSummary(truncation: TruncationDetails): string {
  const partialNote = truncation.lastLinePartial ? " · partial final line" : "";
  return `Preview truncated · ${truncation.outputLines}/${truncation.totalLines} lines${partialNote}`;
}

function findLastLineIndex(
  lines: string[],
  predicate: (line: string, index: number) => boolean,
): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (predicate(lines[i] ?? "", i)) return i;
  }
  return -1;
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

  const { defaultTailLines, maxOutputLines } = configLoader.getConfig().output;
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

  // Build the stripped body text. stdout/stderr stay local and are never
  // persisted in `details`; only the bounded preview survives in `content`.
  const bodyLines: string[] = [];
  if (output.stdout.length > 0) {
    bodyLines.push("stdout:");
    bodyLines.push(...output.stdout.map(stripAnsi));
  }
  if (output.stderr.length > 0) {
    if (bodyLines.length > 0) bodyLines.push("");
    bodyLines.push("stderr:");
    bodyLines.push(...output.stderr.map(stripAnsi));
  }

  const guidance =
    output.status === "running"
      ? "Process is still running. Use watches instead of polling."
      : null;

  const { contentText, truncation } = buildBoundedOutput(
    message,
    bodyLines.join("\n"),
    guidance,
    logFiles,
    maxOutputLines,
  );

  const details: ProcessesDetails = {
    action: "output",
    success: true,
    message,
    logFiles: logFiles
      ? {
          stdoutFile: logFiles.stdoutFile,
          stderrFile: logFiles.stderrFile,
        }
      : undefined,
  };

  if (truncation.truncated) {
    const { content: _content, ...rest } = truncation;
    details.truncation = rest;
  }

  return {
    content: [{ type: "text", text: contentText }],
    details,
  };
}

/**
 * Compose the bounded content text. The header, optional guidance, truncation
 * notice, and complete-log footer live outside the truncation window, so the
 * agent always receives log paths even when the body is truncated.
 *
 * The byte and line budgets apply to the composed+JSON-escaped result. If the
 * first pass overflows (because JSON escaping expands control characters or
 * the fixed metadata consumes the budget), the body budget is shrunk and the
 * body re-truncated while keeping the newest output.
 */
function buildBoundedOutput(
  header: string,
  body: string,
  guidance: string | null,
  logFiles: { stdoutFile: string; stderrFile: string } | null,
  maxLines: number,
): { contentText: string; truncation: TruncationResult } {
  let maxBodyBytes = MAX_OUTPUT_BYTES;
  let maxBodyLines = maxLines;

  let truncation = truncateTail(body, {
    maxBytes: maxBodyBytes,
    maxLines: maxBodyLines,
  });
  let contentText = composeContent(header, truncation, guidance, logFiles);

  for (let attempt = 0; attempt < 10; attempt++) {
    const excessBytes =
      Buffer.byteLength(contentText, "utf-8") - MAX_OUTPUT_BYTES;
    const excessLines = countLines(contentText) - maxLines;
    const excessJsonBytes =
      Buffer.byteLength(JSON.stringify(contentText), "utf-8") -
      MAX_OUTPUT_JSON_BYTES;

    if (excessBytes <= 0 && excessLines <= 0 && excessJsonBytes <= 0) {
      return { contentText, truncation };
    }

    maxBodyBytes = Math.max(0, maxBodyBytes - Math.max(0, excessBytes));
    if (excessJsonBytes > 0) {
      maxBodyBytes = Math.floor(maxBodyBytes / 2);
    }
    maxBodyLines = Math.max(1, maxBodyLines - Math.max(0, excessLines));

    truncation = truncateTail(body, {
      maxBytes: maxBodyBytes,
      maxLines: maxBodyLines,
    });
    contentText = composeContent(header, truncation, guidance, logFiles);
  }

  // Pathological metadata can still consume the whole budget. Bound the final
  // composed string so a session entry cannot grow unbounded.
  const finalTruncation = truncateTail(contentText, {
    maxBytes: MAX_OUTPUT_BYTES,
    maxLines: maxLines,
  });
  return { contentText: finalTruncation.content, truncation };
}

function composeContent(
  header: string,
  truncation: TruncationResult,
  guidance: string | null,
  logFiles: { stdoutFile: string; stderrFile: string } | null,
): string {
  const sections: string[] = [header, truncation.content];

  if (guidance) {
    sections.push(guidance);
  }

  if (truncation.truncated) {
    sections.push(formatTruncationNotice(truncation));
  }

  if (logFiles) {
    sections.push(
      `${LOG_FOOTER_MARKER}\nstdout=${logFiles.stdoutFile}\nstderr=${logFiles.stderrFile}]`,
    );
  }

  return sections.filter((section) => section.length > 0).join("\n\n");
}
