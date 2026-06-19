import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function createPanelPadder(width: number): (content: string) => string {
  return (content: string): string => {
    const truncated = truncateToWidth(content, width, "", true);
    const padding = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
    return `${truncated}${padding}`;
  };
}

export function renderPanelRule(width: number, theme: Theme): string {
  if (width <= 0) return "";
  return theme.fg("dim", "─".repeat(width));
}

export function renderPanelTitleLine(
  title: string,
  width: number,
  theme: Theme,
): string {
  if (width <= 0) return "";

  const label = ` ${title} `;
  const truncated = truncateToWidth(label, width, "", true);
  const remaining = Math.max(0, width - visibleWidth(truncated));

  return theme.fg("dim", `${truncated}${"─".repeat(remaining)}`);
}
