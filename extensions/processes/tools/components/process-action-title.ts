import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export class ProcessActionTitle extends Text {
  constructor(action: string, theme: Theme, suffix?: string) {
    const parts = [
      theme.fg("toolTitle", theme.bold("Process:")),
      theme.fg("muted", action),
    ];

    if (suffix) {
      parts.push(suffix);
    }

    super(parts.join(" "), 0, 0);
  }
}
