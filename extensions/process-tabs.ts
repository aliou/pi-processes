import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { LIVE_STATUSES, type ProcessInfo } from "../src/types";

const MAX_TAB_NAME = 12;

export function renderProcessTab(
  process: ProcessInfo,
  active: boolean,
  theme: Theme,
): string {
  const dot = renderProcessTabDot(process, active, theme);
  const label = truncateToWidth(process.name, MAX_TAB_NAME, "", true);
  return active
    ? theme.bg("selectedBg", ` ${dot} ${theme.fg("accent", label)} `)
    : ` ${dot} ${theme.fg("dim", label)} `;
}

export function renderProcessTabDot(
  process: ProcessInfo,
  active: boolean,
  theme: Theme,
): string {
  if (process.success === false && process.status !== "killed") {
    return theme.fg("error", "!");
  }
  if (LIVE_STATUSES.has(process.status)) {
    return active ? theme.fg("accent", "●") : theme.fg("dim", "○");
  }
  return theme.fg("dim", "■");
}
