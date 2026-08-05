import type {
  ExtensionAPI,
  MessageRenderOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Text } from "@earendil-works/pi-tui";
import { truncateToWidth } from "../shared/truncate";
import { MESSAGE_TYPE_PROCESS_NOTIFICATION } from "./constants";
import type { ProcessNotificationDetails } from "./notifications/types";

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

  const container = new Container();
  container.addChild(new Text(formatSummary(details, theme), 0, 0));

  if (options.expanded) {
    container.addChild(new Text(formatDetailLine(details, theme), 0, 1));
  }

  return container;
}

function formatSummary(
  details: ProcessNotificationDetails,
  theme: Theme,
): string {
  const prefix = theme.fg("accent", "[process]");
  const name = theme.fg("muted", `"${details.processName}"`);

  if (details.logMatch) {
    const line = truncateToWidth(details.logMatch.line, 160, "…");
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
  const parts = [
    `id: ${details.processId}`,
    `attention: ${details.attention}`,
    details.status ? `status: ${details.status}` : null,
    details.exitCode === undefined || details.exitCode === null
      ? null
      : `exit: ${details.exitCode}`,
    details.endReason ? `reason: ${details.endReason}` : null,
  ].filter(Boolean);

  return theme.fg("muted", parts.join("  "));
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
