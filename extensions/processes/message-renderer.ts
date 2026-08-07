import type {
  ExtensionAPI,
  MessageRenderOptions,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text } from "@earendil-works/pi-tui";
import { truncateForDisplay } from "../shared/display-text";
import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "./constants";
import type {
  Attention,
  ProcessNotificationDetails,
  ProcessNotificationKind,
} from "./notifications/types";
import { formatPatternForDisplay, quoteFilter } from "./tools/components";

export function registerProcessNotificationRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<ProcessNotificationDetails>(
    MESSAGE_TYPE_PROCESS_NOTIFICATION,
    renderProcessNotificationMessage,
  );
}

export function renderProcessNotificationMessage(
  message: { details?: ProcessNotificationDetails },
  options: MessageRenderOptions,
  theme: Theme,
): Component | undefined {
  const details = message.details;
  if (!details) {
    return undefined;
  }

  // outputPad is only populated on Pi 0.82.1+ (see MessageRenderOptions);
  // fall back to 0 so this renderer doesn't break on older Pi builds.
  const outputPad = options.outputPad ?? 0;

  const container = new Container();
  container.addChild(new Text(formatSummary(details, theme), outputPad, 0));

  if (options.expanded) {
    container.addChild(
      new Text(formatDetailLine(details, theme), outputPad, 0),
    );
  }

  return container;
}

function formatSummary(
  details: ProcessNotificationDetails,
  theme: Theme,
): string {
  const prefix = theme.fg("accent", "[process]");
  const name = theme.fg(
    "muted",
    `"${truncateForDisplay(details.processName, 60)}"`,
  );

  if (details.logMatch) {
    // Matched text is raw process output: sanitize before it reaches the
    // transcript, or an escape sequence in a log line hits the terminal.
    const line = truncateForDisplay(details.logMatch.line, 160);
    return `${prefix} ${name} matched ${details.logMatch.stream}: ${line}`;
  }

  if (details.kind === "killed" && details.signal) {
    const number =
      details.signal.number === null ? "" : ` (${details.signal.number})`;
    return `${prefix} ${name} killed by ${details.signal.name}${number}`;
  }

  const severity = colorKind(details.kind, theme, summaryVerb(details));
  return `${prefix} ${name} ${severity}`;
}

function formatDetailLine(
  details: ProcessNotificationDetails,
  theme: Theme,
): string {
  const parts: string[] = [
    field("id", details.processId, theme),
    field("notify", formatAttention(details.attention, theme), theme),
  ];

  if (details.logMatch) {
    const pattern = quoteFilter(
      formatPatternForDisplay(details.logMatch.pattern),
      details.logMatch.mode,
    );
    parts.push(
      field("pattern", theme.fg("accent", pattern), theme),
      field("stream", theme.fg("muted", `[${details.logMatch.stream}]`), theme),
    );
  } else {
    if (details.status) {
      parts.push(
        field(
          "status",
          theme.fg(statusTone(details.kind), details.status),
          theme,
        ),
      );
    }

    if (details.exitCode !== undefined && details.exitCode !== null) {
      parts.push(
        field(
          "exit",
          theme.fg(statusTone(details.kind), String(details.exitCode)),
          theme,
        ),
      );
    }

    if (details.endReason) {
      parts.push(field("reason", theme.fg("muted", details.endReason), theme));
    }

    if (details.signal) {
      const number =
        details.signal.number === null
          ? ""
          : ` (${details.signal.number}, ${details.signal.description})`;
      parts.push(
        field(
          "signal",
          theme.fg("muted", `${details.signal.name}${number}`),
          theme,
        ),
      );
    }
  }

  return parts.join("  ");
}

/** `label:` in muted, matching `buildField` in tools/utils.ts. */
function field(label: string, value: string, theme: Theme): string {
  return `${theme.fg("muted", `${label}:`)} ${value}`;
}

/**
 * Plain-language attention level, reusing the tone mapping from
 * `attentionTone` in tools/components/watch.ts (turn/context keep their
 * color; ignore switches from muted to dim to read as "quieter").
 */
function formatAttention(attention: Attention, theme: Theme): string {
  switch (attention) {
    case "turn":
      return theme.bold(theme.fg("warning", "now"));
    case "context":
      return theme.bold(theme.fg("success", "next turn"));
    default:
      return theme.bold(theme.fg("dim", "silent"));
  }
}

/**
 * Same tone family as `statusColor` in shared/ui.ts: success for a clean
 * exit, error for failure/crash, dim for killed.
 */
function statusTone(kind: ProcessNotificationKind): ThemeColor {
  switch (kind) {
    case "success":
      return "success";
    case "failure":
    case "crash":
      return "error";
    case "killed":
      return "dim";
    default:
      return "muted";
  }
}

function summaryVerb(details: ProcessNotificationDetails): string {
  if (details.summary) {
    return details.summary;
  }

  switch (details.kind) {
    case "success":
      return "succeeded";
    case "failure":
    case "crash":
      return details.exitCode === null || details.exitCode === undefined
        ? "failed"
        : `failed exit(${details.exitCode})`;
    case "killed":
      return "killed";
    case "log_match":
      return "matched log output";
    case "log_match_suppressed":
      return "suppressed repeated log matches";
  }
}

function colorKind(
  kind: ProcessNotificationDetails["kind"],
  theme: Theme,
  text: string,
): string {
  switch (kind) {
    case "success":
      return theme.fg("success", text);
    case "killed":
      return theme.fg("warning", text);
    case "failure":
    case "crash":
      return theme.fg("error", text);
    case "log_match":
    case "log_match_suppressed":
      return theme.fg("accent", text);
  }
}
