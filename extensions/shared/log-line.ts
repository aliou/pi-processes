/**
 * One renderer for a single line of process output, shared by the `/ps`
 * preview, the `/ps:logs` overlay, and the dock.
 *
 * Every log view sanitizes untrusted output, truncates it to the row width,
 * and tones it by stream and match state. Keeping that in one place is what
 * stops the three views from drifting apart again.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import {
  closeSgr,
  plainTextForDisplay,
  sanitizeForDisplay,
  stripSgr,
} from "./display-text";
import { truncateToWidth } from "./truncate";

export interface DisplayLogLine {
  type: "stdout" | "stderr";
  text: string;
}

/**
 * Why a line stands out, in priority order. `search-current` is the match the
 * user is sitting on, `search` is any other hit, `notify` is a watch match.
 */
export type LogLineEmphasis = "none" | "notify" | "search" | "search-current";

export interface RenderLogLineOptions {
  theme: Theme;
  /** Total row width, including `prefix`. */
  width: number;
  emphasis?: LogLineEmphasis;
  /** Already-styled row prefix, such as the dock's process label. */
  prefix?: string;
  /** Drop colors from the log text itself. Match and stream tones still apply. */
  plain?: boolean;
}

export function renderLogLine(
  line: DisplayLogLine,
  options: RenderLogLineOptions,
): string {
  const {
    theme,
    width,
    emphasis = "none",
    prefix = "",
    plain = false,
  } = options;
  if (width <= 0) return "";

  const prefixWidth = visibleWidth(prefix);
  const textWidth = Math.max(1, width - prefixWidth);
  const safe = sanitizeForDisplay(line.text);
  const text = closeSgr(
    truncateToWidth(plain ? stripSgr(safe) : safe, textWidth, "", true),
  );

  return `${prefix}${toneLogText(text, line.type, emphasis, theme)}`;
}

/** Text of a log line as the views display it, for match comparisons. */
export function displayTextOf(line: DisplayLogLine): string {
  return plainTextForDisplay(line.text);
}

function toneLogText(
  text: string,
  type: DisplayLogLine["type"],
  emphasis: LogLineEmphasis,
  theme: Theme,
): string {
  if (emphasis === "search-current") return theme.bold(theme.inverse(text));
  if (emphasis === "search") return theme.fg("warning", text);
  if (emphasis === "notify") return theme.underline(text);
  if (type === "stderr") return theme.fg("warning", text);
  return text;
}
