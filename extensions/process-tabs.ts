import type { Theme } from "@earendil-works/pi-coding-agent";

import type { ProcessInfo } from "../src/types";
import { truncateCmd } from "../src/utils/format";
import { MAX_TAB_NAME, statusDot } from "./shared/ui";

export { MAX_TAB_NAME, statusDot as renderProcessTabDot };

/**
 * Render a process tab: ` dot label ` with active highlight.
 *
 * Truncates the name to `MAX_TAB_NAME` without padding, so tabs stay compact
 * (`● api` not `● api         `). The active tab is rendered on a selected
 * background; inactive tabs use a dim label.
 */
export function renderProcessTab(
  process: ProcessInfo,
  active: boolean,
  theme: Theme,
): string {
  const dot = statusDot(process, active, theme);
  const label = truncateCmd(process.name, MAX_TAB_NAME);
  return active
    ? theme.bg("selectedBg", ` ${dot} ${theme.fg("accent", label)} `)
    : ` ${dot} ${theme.fg("dim", label)} `;
}
