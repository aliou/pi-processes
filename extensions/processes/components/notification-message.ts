import type {
  MessageRenderOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Text,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { truncateForDisplay } from "../../shared/display-text";
import type { ProcessNotificationDetails } from "../notifications/types";
import { formatPatternForDisplay, quoteFilter } from "../tools/components";

export function renderProcessNotificationMessage(
  message: { details?: ProcessNotificationDetails },
  options: MessageRenderOptions,
  theme: Theme,
): Component | undefined {
  const details = message.details;
  if (!details) {
    return undefined;
  }

  return new ProcessNotificationComponent(
    details,
    theme,
    options.outputPad ?? 0,
    options.expanded,
  );
}

class ProcessNotificationComponent extends Container {
  private readonly detailList = new Container();
  private expanded: boolean;

  constructor(
    details: ProcessNotificationDetails,
    theme: Theme,
    outputPad: number,
    expanded: boolean,
  ) {
    super();
    this.expanded = expanded;
    this.addChild(
      new ProcessNotificationSummary(details, theme, outputPad, () =>
        this.setExpanded(!this.expanded),
      ),
    );
    this.detailList.addChild(buildDetails(details, theme, outputPad));
    if (expanded) this.addChild(this.detailList);
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    if (expanded) {
      this.addChild(this.detailList);
    } else {
      this.removeChild(this.detailList);
    }
    this.invalidate();
  }
}

class ProcessNotificationSummary extends Text {
  constructor(
    details: ProcessNotificationDetails,
    theme: Theme,
    outputPad: number,
    private readonly toggle: () => void,
  ) {
    super(formatSummary(details, theme), outputPad, 0);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click") return undefined;
    this.toggle();
    return { handled: true };
  }
}

function formatSummary(
  details: ProcessNotificationDetails,
  theme: Theme,
): string {
  const prefix = theme.fg("accent", "[process]");
  const attention =
    details.attention === "turn"
      ? theme.fg("warning", "alerted")
      : theme.fg("dim", "info");
  const name = theme.bold(`\`${truncateForDisplay(details.processName, 60)}\``);

  if (details.logMatch) {
    const line = truncateForDisplay(details.logMatch.line, 160);
    return `${prefix} ${attention} ${name} ${attentionText(details, `matched ${details.logMatch.stream}: ${line}`, theme)}`;
  }

  if (details.kind === "killed" && details.signal) {
    const number =
      details.signal.number === null ? "" : ` (${details.signal.number})`;
    return `${prefix} ${attention} ${name} killed by ${details.signal.name}${number}`;
  }

  const severity = colorKind(details.kind, theme, summaryVerb(details));
  return `${prefix} ${attention} ${name} ${severity}`;
}

function detailRows(
  details: ProcessNotificationDetails,
): Array<[string, string]> {
  const rows: Array<[string, string]> = [["id", details.processId]];

  if (details.logMatch) {
    const pattern = quoteFilter(
      formatPatternForDisplay(details.logMatch.pattern),
      details.logMatch.mode,
    );
    rows.push(["pattern", pattern], ["stream", `[${details.logMatch.stream}]`]);
    return rows;
  }

  if (details.status) rows.push(["status", details.status]);
  if (details.exitCode !== undefined && details.exitCode !== null) {
    rows.push(["exit", String(details.exitCode)]);
  }
  if (details.endReason) rows.push(["reason", details.endReason]);
  if (details.signal) {
    const number =
      details.signal.number === null
        ? ""
        : ` (${details.signal.number}, ${details.signal.description})`;
    rows.push(["signal", `${details.signal.name}${number}`]);
  }
  return rows;
}

function buildDetails(
  details: ProcessNotificationDetails,
  theme: Theme,
  outputPad: number,
): Component {
  const text = detailRows(details)
    .map(
      ([label, value]) =>
        `${theme.fg("muted", `${label}:`)} ${attentionText(details, value, theme)}`,
    )
    .join("  ");
  return new Text(`  ${text}`, outputPad, 0);
}

function attentionText(
  details: ProcessNotificationDetails,
  text: string,
  theme: Theme,
): string {
  return details.attention === "turn" ? text : theme.fg("dim", text);
}

function summaryVerb(details: ProcessNotificationDetails): string {
  if (details.summary) {
    const prefix = `Process "${details.processName}" `;
    return details.summary.startsWith(prefix)
      ? details.summary.slice(prefix.length)
      : details.summary;
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
