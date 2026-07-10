import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ProcessInfo } from "../src/types";
import { statusDot } from "./shared/ui";

const MAX_TAB_NAME = 12;

export function renderProcessTab(
  process: ProcessInfo,
  active: boolean,
  theme: Theme,
): string {
  const dot = statusDot(process, active, theme);
  const label = truncateToWidth(process.name, MAX_TAB_NAME, "", true);
  return active
    ? theme.bg("selectedBg", ` ${dot} ${theme.fg("accent", label)} `)
    : ` ${dot} ${theme.fg("dim", label)} `;
}

export { statusDot as renderProcessTabDot };
