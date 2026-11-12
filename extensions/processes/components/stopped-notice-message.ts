import {
  keyText,
  type MessageRenderOptions,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Text,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
  sanitizeForDisplay,
  truncateForDisplay,
} from "../../shared/display-text";
import type {
  ProcessesStoppedDetails,
  StoppedProcessRecord,
} from "../hooks/stopped-notice";

export function renderStoppedNoticeMessage(
  message: { details?: ProcessesStoppedDetails },
  options: MessageRenderOptions,
  theme: Theme,
): Component | undefined {
  const details = message.details;
  if (!details) {
    return undefined;
  }
  return new StoppedNoticeComponent(
    details,
    theme,
    options.outputPad ?? 0,
    options.expanded,
  );
}

class StoppedNoticeComponent extends Container {
  private readonly processList = new Container();
  private readonly summary: StoppedNoticeSummary;
  private expanded: boolean;

  constructor(
    details: ProcessesStoppedDetails,
    theme: Theme,
    outputPad: number,
    expanded: boolean,
  ) {
    super();
    this.expanded = expanded;
    const toggle = () => this.setExpanded(!this.expanded);
    this.summary = new StoppedNoticeSummary(
      details.processes.length,
      theme,
      outputPad,
      expanded,
      toggle,
    );
    this.addChild(this.summary);
    for (const process of details.processes) {
      this.processList.addChild(
        new StoppedProcessRow(process, theme, outputPad, toggle),
      );
    }
    if (expanded) this.addChild(this.processList);
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.summary.setExpanded(expanded);
    if (expanded) {
      this.addChild(this.processList);
    } else {
      this.removeChild(this.processList);
    }
    this.invalidate();
  }
}

class StoppedNoticeText extends Text {
  constructor(
    text: string,
    outputPad: number,
    private readonly toggle: () => void,
  ) {
    super(text, outputPad, 0);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click") return undefined;
    this.toggle();
    return { handled: true };
  }
}

class StoppedNoticeSummary extends StoppedNoticeText {
  constructor(
    private readonly count: number,
    private readonly theme: Theme,
    outputPad: number,
    expanded: boolean,
    toggle: () => void,
  ) {
    super(formatSummary(count, expanded, theme), outputPad, toggle);
  }

  setExpanded(expanded: boolean): void {
    this.setText(formatSummary(this.count, expanded, this.theme));
  }
}

class StoppedProcessRow extends StoppedNoticeText {
  constructor(
    process: StoppedProcessRecord,
    theme: Theme,
    outputPad: number,
    toggle: () => void,
  ) {
    const name = truncateForDisplay(process.name, 40);
    const command = sanitizeForDisplay(process.command);
    super(
      `  ${theme.bold(name)} ${theme.fg("accent", command)}`,
      outputPad,
      toggle,
    );
  }
}

function formatSummary(count: number, expanded: boolean, theme: Theme): string {
  const prefix = theme.fg("accent", "[processes]");
  const noun = count === 1 ? "process was" : "processes were";
  const summary = theme.fg("dim", `${count} ${noun} not resumed`);
  const action = expanded ? "collapse" : "expand";
  const hint = theme.fg(
    "dim",
    ` (${keyText("app.tools.expand")} to ${action})`,
  );
  return `${prefix} ${summary}${hint}`;
}
