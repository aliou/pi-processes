import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ProcessInfo } from "../../../src/types";
import { formatRuntime, truncateCmd } from "../../../src/utils/format";
import { formatStatusTag } from "./status-format";

export class ProcessPickerComponent {
  constructor(
    private readonly processes: ProcessInfo[],
    private readonly selectedIndex: number,
    private readonly theme: Theme,
  ) {}

  render(width: number): string[] {
    if (this.processes.length === 0) {
      return [this.theme.fg("muted", "No managed processes.")];
    }

    return this.processes.map((process, index) => {
      const marker =
        index === this.selectedIndex ? this.theme.fg("accent", ">") : " ";
      const status = formatStatusTag(process, this.theme);
      const runtime = formatRuntime(process.startTime, process.endTime);
      const line = `${marker} ${process.name} ${this.theme.fg("dim", process.id)} ${status} ${this.theme.fg("muted", runtime)} ${truncateCmd(process.command, 60)}`;
      return truncateToWidth(line, Math.max(1, width));
    });
  }
}
