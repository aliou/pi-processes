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
import type { ProcessesStoppedDetails } from "../hooks/stopped-notice";

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

class StoppedNoticeComponent implements Component {
  constructor(
    private readonly details: ProcessesStoppedDetails,
    private readonly theme: Theme,
    private readonly outputPad: number,
    private expanded: boolean,
  ) {}

  invalidate(): void {}

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click") return undefined;
    this.expanded = !this.expanded;
    return { handled: true };
  }

  render(width: number): string[] {
    const container = new Container();
    container.addChild(
      new Text(
        summaryLine(this.details.processes.length, this.theme),
        this.outputPad,
        0,
      ),
    );
    if (this.expanded) {
      for (const process of this.details.processes) {
        container.addChild(
          new Text(processLine(process, width, this.theme), this.outputPad, 0),
        );
      }
    }
    return container.render(width);
  }
}

function summaryLine(count: number, theme: Theme): string {
  const prefix = theme.fg("accent", "[processes]");
  const noun = count === 1 ? "process was" : "processes were";
  return `${prefix} ${count} background ${noun} stopped when the session ended`;
}

function processLine(
  process: ProcessesStoppedDetails["processes"][number],
  width: number,
  theme: Theme,
): string {
  const name = truncateForDisplay(process.name, 40);
  const command = truncateForDisplay(process.command, Math.max(width - 4, 20));
  return `  ${theme.fg("muted", name)} ${theme.fg("accent", command)}`;
}
