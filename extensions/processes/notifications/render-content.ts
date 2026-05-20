import type { ProcessNotificationDetails } from "./types";

export function buildProcessNotificationContent(
  details: ProcessNotificationDetails,
): string {
  if (details.kind === "log_match" && details.logMatch) {
    return buildLogMatchContent(details);
  }

  return buildLifecycleContent(details);
}

function buildLifecycleContent(details: ProcessNotificationDetails): string {
  const attrs = [
    attr("type", "lifecycle"),
    attr("kind", details.kind),
    attr("process_id", details.processId),
    attr("process_name", details.processName),
    details.status ? attr("status", details.status) : null,
  ]
    .filter(Boolean)
    .join(" ");

  const lines = [
    `<process_event ${attrs}>`,
    element("summary", details.summary, 1),
    element("command", details.command, 1),
  ];

  if (details.exitCode !== undefined && details.exitCode !== null) {
    lines.push(element("exit_code", String(details.exitCode), 1));
  }

  if (details.endReason) {
    lines.push(element("end_reason", details.endReason, 1));
  }

  if (details.signal) {
    const signalAttrs = [
      attr("name", details.signal.name),
      details.signal.number === null
        ? null
        : attr("number", String(details.signal.number)),
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(element("signal", details.signal.description, 1, signalAttrs));
  }

  lines.push(
    element(
      "logs_hint",
      `Use process output/logs for process ${details.processId} to inspect recent output.`,
      1,
    ),
  );
  lines.push("</process_event>");

  return lines.join("\n");
}

function buildLogMatchContent(details: ProcessNotificationDetails): string {
  const logMatch = details.logMatch;
  if (!logMatch) {
    return buildLifecycleContent(details);
  }

  const attrs = [
    attr("type", "log_match"),
    attr("kind", details.kind),
    attr("process_id", details.processId),
    attr("process_name", details.processName),
  ].join(" ");

  return [
    `<process_event ${attrs}>`,
    element("summary", details.summary, 1),
    element("pattern", logMatch.pattern, 1, attr("mode", logMatch.mode)),
    element("stream", logMatch.stream, 1),
    element("matched_line", logMatch.line, 1),
    "</process_event>",
  ].join("\n");
}

function element(
  name: string,
  value: string,
  indent: number,
  attrs?: string,
): string {
  const padding = "  ".repeat(indent);
  const attrText = attrs ? ` ${attrs}` : "";
  return `${padding}<${name}${attrText}>${escapeXmlText(value)}</${name}>`;
}

function attr(name: string, value: string): string {
  return `${name}="${escapeXmlAttribute(value)}"`;
}

export function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
