import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";

import { ProcessActionHeader } from "../components";
import type { ProcessesParamsType } from "../schema";
import { buildField } from "../utils";
import type { OutputDetails } from ".";

export function buildHeader(
  args: ProcessesParamsType,
  theme: Theme,
  options?: { expanded?: boolean },
): Container {
  const suffix = args.id ? theme.fg("accent", `(${args.id})`) : undefined;
  return new ProcessActionHeader(args, theme, {
    action: "output",
    expanded: options?.expanded,
    suffix,
  });
}

export function buildExpanded(
  contentText: string,
  details: OutputDetails,
  theme: Theme,
): Container {
  const container = new Container();
  container.addChild(buildOutputMeta(details, theme));

  const bodyLines = extractOutputBody(contentText, details);

  if (bodyLines.length > 0) {
    container.addChild(new Spacer(1));
    for (const line of bodyLines) {
      container.addChild(new Text(line, 0, 0));
    }
  } else {
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("muted", emptyMessage(details)), 0, 0),
    );
  }

  if (details.truncation) {
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("muted", buildTruncationSummary(details)), 0, 0),
    );
  }

  return container;
}

export function buildCollapsed(
  contentText: string,
  details: OutputDetails,
  theme: Theme,
): Container {
  const container = new Container();

  container.addChild(
    new Text(
      [
        details.processName,
        theme.fg("accent", details.id),
        theme.fg(getStatusTone(details), details.processStatus),
      ]
        .filter(Boolean)
        .join("  "),
      0,
      0,
    ),
  );

  const bodyLines = extractOutputBody(contentText, details);
  const preview = bodyLines.slice(-2).join("\n");

  if (preview) {
    container.addChild(new Text(theme.fg("muted", preview), 0, 0));
  } else {
    container.addChild(
      new Text(theme.fg("muted", emptyMessage(details)), 0, 0),
    );
  }

  return container;
}

export function buildFooter(
  details: OutputDetails,
  options: { expanded?: boolean },
  theme: Theme,
): Container | null {
  if (!options.expanded) return null;

  const container = new Container();
  container.addChild(new Text(theme.fg("muted", "logs:"), 0, 0));
  container.addChild(
    new Text(`  ${theme.fg("accent", details.stdoutFile)}`, 0, 0),
  );
  container.addChild(
    new Text(`  ${theme.fg("accent", details.stderrFile)}`, 0, 0),
  );
  return container;
}

function buildOutputMeta(details: OutputDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(buildField("name", details.processName, theme));
  container.addChild(buildField("id", details.id, theme));
  container.addChild(
    buildField(
      "status",
      theme.fg(getStatusTone(details), details.processStatus),
      theme,
    ),
  );
  container.addChild(buildField("stream", details.stream, theme));

  if (details.pattern) {
    const modeTag = details.mode === "regex" ? " (regex)" : "";
    container.addChild(
      buildField("filter", `${details.pattern}${modeTag}`, theme),
    );
  }

  return container;
}

function emptyMessage(details: OutputDetails): string {
  return details.pattern ? "No matching lines found" : "No output yet";
}

function buildTruncationSummary(details: OutputDetails): string {
  const truncation = details.truncation;
  if (!truncation) return "";

  const partialNote = truncation.lastLinePartial ? " · partial final line" : "";
  return `Preview truncated · ${truncation.outputLines}/${truncation.totalLines} lines${partialNote}`;
}

function getStatusTone(
  details: OutputDetails,
): "success" | "warning" | "error" | "muted" {
  if (details.processStatus === "running") return "success";
  if (details.processStatus === "killed") return "warning";
  return "muted";
}

/**
 * Extract process output from the tool-result content text.
 *
 * The content text is structured as:
 *   - a one- or two-line header with process metadata and filter;
 *   - the bounded output body;
 *   - optional running guidance and truncation notice;
 *   - a final `[Complete currently-retained logs: ...]` footer.
 *
 * The renderer uses details for metadata, guidance, truncation state, and log
 * paths. Only process output is returned here. Legacy content that has lost
 * its header through tail truncation is also accepted.
 */
function extractOutputBody(
  contentText: string,
  details: OutputDetails,
): string[] {
  const lines = contentText.split("\n");

  const expectedHeader = `"${details.processName}" (${details.id}) [${details.processStatus}]`;
  let bodyStart = lines[0] === expectedHeader ? 1 : 0;
  if (lines[bodyStart]?.startsWith("filter: ")) {
    bodyStart++;
  }

  // Use the final exact marker so process output containing the same text does
  // not terminate the rendered preview.
  const footerStart = findLastLineIndex(
    lines,
    (line) => line === "[Complete currently-retained logs:",
  );
  let bodyEnd = footerStart >= 0 ? footerStart : lines.length;

  if (details.truncation) {
    const truncationNotice = findLastLineIndex(
      lines,
      (line, index) =>
        index < bodyEnd && line.startsWith("[Preview truncated by "),
    );
    if (truncationNotice >= bodyStart) {
      bodyEnd = truncationNotice;
    }
  }

  if (details.processStatus === "running") {
    const guidance = findLastLineIndex(
      lines,
      (line, index) =>
        index < bodyEnd &&
        line === "Process is still running. Use watches instead of polling.",
    );
    if (guidance >= bodyStart) {
      bodyEnd = guidance;
    }
  }

  const body = lines.slice(bodyStart, bodyEnd);

  // Trim leading/trailing blank lines while preserving internal blank lines.
  let start = 0;
  while (start < body.length && body[start] === "") {
    start++;
  }
  let end = body.length;
  while (end > start && body[end - 1] === "") {
    end--;
  }

  return body.slice(start, end);
}

function findLastLineIndex(
  lines: string[],
  predicate: (line: string, index: number) => boolean,
): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (predicate(lines[index] ?? "", index)) return index;
  }
  return -1;
}
