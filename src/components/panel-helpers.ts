import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function createPanelPadder(width: number): (content: string) => string {
  const innerWidth = Math.max(0, width - 2);

  return (content: string): string => {
    const truncated = truncateToWidth(content, innerWidth, "", true);
    const padding = " ".repeat(
      Math.max(0, innerWidth - visibleWidth(truncated)),
    );
    return `│${truncated}${padding}│`;
  };
}

export function renderPanelRule(width: number, theme: Theme): string {
  if (width <= 0) return "";
  if (width === 1) return theme.fg("dim", "─");

  return theme.fg("dim", `├${"─".repeat(Math.max(0, width - 2))}┤`);
}

export function renderPanelTitleLine(
  title: string,
  width: number,
  theme: Theme,
): string {
  if (width <= 0) return "";
  if (width === 1) return theme.fg("dim", "─");

  const innerWidth = Math.max(0, width - 2);
  const label = ` ${title} `;
  const truncated = truncateToWidth(label, innerWidth, "", true);
  const remaining = Math.max(0, innerWidth - visibleWidth(truncated));

  return theme.fg("dim", `┌${truncated}${"─".repeat(remaining)}┐`);
}
