/**
 * Footer shortcut-hint rendering shared by the `/ps` overview and the
 * `/ps:logs` overlay footers.
 *
 * Each hint renders in one of two modes:
 *
 * - Minimal: when the hint's key is a single character that occurs in its
 *   label, only the word is shown and every occurrence of the key letter is
 *   rendered in accent + bold. "w wrap" becomes "wrap" with a bold accent
 *   "w"; the remainder of the word keeps the segment style (so a stateful
 *   label like "wrap" can stay dim while off and accent while on).
 * - Classic: `<dim key> <label>` (e.g. "j/k scroll"), used whenever the key
 *   is not a single letter found in the label ("q close", "/ search",
 *   "N prev").
 *
 * `renderShortcutHints` additionally collapses the bar to a leading "? more"
 * affordance when the full list does not fit the available width: the "?"
 * key opens the full shortcuts overlay (see shortcuts-overlay.ts).
 *
 * Keys and labels are static, trusted UI copy — never process output — so
 * they do not go through the untrusted-text sanitizers.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";

import { truncateToWidth } from "./truncate";

/** Style applied to a label segment. */
export type ShortcutLabelStyle = "plain" | "dim" | "accent";

export interface ShortcutLabelSegment {
  /** Segment text (trusted, static UI copy — not process output). */
  text: string;
  style?: ShortcutLabelStyle;
}

export interface ShortcutHint {
  /** Key label as shown to the user, e.g. "w", "j/k", "/", "pgup/pgdn". */
  key: string;
  /**
   * Action label: a plain word, or pre-styled segments for stateful labels
   * (such as the stream filter's "stdout+stderr" whose halves dim and
   * accent independently).
   */
  label: string | ShortcutLabelSegment[];
}

/** Separator between hints in a rendered bar. */
const SEPARATOR = "  ";

/** The key that opens the shortcuts overlay. */
export const SHORTCUTS_KEY = "?";

function styleSegment(
  text: string,
  style: ShortcutLabelStyle,
  theme: Theme,
): string {
  if (text.length === 0) return "";
  if (style === "dim") return theme.fg("dim", text);
  if (style === "accent") return theme.fg("accent", text);
  return text;
}

function segmentsOf(label: ShortcutHint["label"]): ShortcutLabelSegment[] {
  return typeof label === "string" ? [{ text: label }] : label;
}

/** True when the hint can render in minimal mode (single-char key in label). */
function isMinimal(hint: ShortcutHint): boolean {
  if (hint.key.length !== 1) return false;
  return segmentsOf(hint.label).some((segment) =>
    segment.text.includes(hint.key),
  );
}

/** Render a single hint (see module doc for the two modes). */
function renderShortcutHint(hint: ShortcutHint, theme: Theme): string {
  if (isMinimal(hint)) {
    const key = theme.fg("accent", theme.bold(hint.key));
    return segmentsOf(hint.label)
      .map((segment) => {
        const style = segment.style ?? "plain";
        return segment.text
          .split(hint.key)
          .map((piece) => styleSegment(piece, style, theme))
          .join(key);
      })
      .join("");
  }

  const label =
    typeof hint.label === "string"
      ? hint.label
      : segmentsOf(hint.label)
          .map((segment) =>
            styleSegment(segment.text, segment.style ?? "plain", theme),
          )
          .join("");
  return `${theme.fg("dim", hint.key)} ${label}`;
}

/** Render the "? more" affordance shown when the bar overflows. */
function renderMoreHint(theme: Theme): string {
  return `${theme.fg("accent", theme.bold(SHORTCUTS_KEY))}${theme.fg("dim", " more")}`;
}

/**
 * Render a hint bar for the given width. When the full list fits, the hints
 * are joined as-is. When it does not, the bar starts with "? more" (the
 * shortcut that opens the shortcuts overlay) followed by every hint that
 * still fits, in list order.
 */
export function renderShortcutHints(
  hints: ShortcutHint[],
  theme: Theme,
  width: number,
): string {
  const rendered = hints.map((hint) => renderShortcutHint(hint, theme));
  const full = rendered.join(SEPARATOR);
  if (visibleWidth(full) <= width) {
    return truncateToWidth(full, width, "", true);
  }

  let line = renderMoreHint(theme);
  for (const hint of rendered) {
    const next = `${line}${SEPARATOR}${hint}`;
    if (visibleWidth(next) > width) break;
    line = next;
  }
  return truncateToWidth(line, width, "", true);
}

/**
 * Render a footer shortcut-hint bar. Hints are fetched through a getter so
 * stateful labels (wrap on/off, active stream) stay fresh across renders.
 */
export class ShortcutHintsComponent implements Component {
  constructor(
    private readonly getHints: () => ShortcutHint[],
    private readonly theme: Theme,
  ) {}

  render(width: number): string[] {
    return [renderShortcutHints(this.getHints(), this.theme, width)];
  }

  invalidate(): void {}
}
