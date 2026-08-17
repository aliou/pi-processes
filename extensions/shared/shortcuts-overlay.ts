/**
 * The "? more" shortcuts overlay: a small centered panel stacked on top of
 * the `/ps` overview or the `/ps:logs` overlay that lists every shortcut the
 * footer may have truncated away.
 *
 * Layout follows herdr's keybinds panel: a title row (bold lowercase
 * `keybinds` on the left, an inverse `esc close` pill on the right), then
 * grouped sections with accent lowercase headers (`scrolling`, `view`, …),
 * each row rendering keys in accent and the description in the normal
 * foreground, descriptions aligned in one column shared by every group.
 *
 * Opened through `showShortcutsOverlay`, which pushes the component onto the
 * TUI overlay stack (`tui.showOverlay`) so it renders above the calling
 * overlay and captures keyboard focus; dismissing it restores focus to the
 * caller. Any of `?`, `esc`, `enter`, `q`, or `ctrl+c` dismisses it.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Key,
  matchesKey,
  type OverlayHandle,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";

import { truncateToWidth } from "./truncate";

/** One shortcut row: keys (already display-formatted) + description. */
export interface ShortcutRow {
  /** Key tokens joined with " / ", e.g. "j / k", "ctrl+u / ctrl+d". */
  keys: string;
  /** Action description, e.g. "line up / down". */
  description: string;
}

/** A named group of shortcut rows. */
export interface ShortcutGroup {
  /** Lowercase group header, e.g. "scrolling". */
  title: string;
  rows: ShortcutRow[];
}

export interface ShortcutsOverlayOptions {
  theme: Theme;
  /** Groups to render, in order (the title row and close pill are fixed). */
  groups: ShortcutGroup[];
  /** Called when the user dismisses the overlay. */
  onDismiss: () => void;
}

const OVERLAY_TITLE = "keybinds";
const CLOSE_PILL = " esc close ";
const KEY_COLUMN_GAP = 3;
const PANEL_PADDING = 1;
const MIN_OVERLAY_WIDTH = 36;
const MAX_OVERLAY_WIDTH = 72;

export class ShortcutsOverlayComponent implements Component {
  private readonly contentWidth: number;

  constructor(private readonly opts: ShortcutsOverlayOptions) {
    this.contentWidth = computeKeyColumn(opts.groups);
  }

  render(width: number): string[] {
    const theme = this.opts.theme;
    const inner = Math.max(1, width - 2); // borders
    const pad = Math.max(0, Math.min(PANEL_PADDING, inner));
    const contentWidth = Math.max(1, inner - pad * 2);

    const lines: string[] = [];
    lines.push(borderTop(theme, inner, OVERLAY_TITLE));
    lines.push(
      contentLine(theme, inner, pad, this.renderTitleRow(contentWidth)),
    );
    let first = true;
    for (const group of this.opts.groups) {
      if (!first) lines.push(blankLine(inner));
      first = false;
      lines.push(
        contentLine(
          theme,
          inner,
          pad,
          theme.fg("accent", theme.bold(group.title)),
        ),
      );
      const keyColumn = this.contentWidth;
      for (const row of group.rows) {
        const keys = theme.fg("accent", row.keys);
        const gap = " ".repeat(
          Math.max(1, keyColumn - visibleWidth(row.keys) + KEY_COLUMN_GAP - 1),
        );
        const description = row.description;
        lines.push(
          contentLine(theme, inner, pad, `${keys}${gap}${description}`),
        );
      }
    }
    lines.push(blankLine(inner));
    lines.push(borderBottom(theme, inner));
    return lines;
  }

  /**
   * Title row: the inverse `esc close` pill, right-aligned. The bold title
   * itself lives in the top border, so it is not duplicated here.
   */
  private renderTitleRow(width: number): string {
    const theme = this.opts.theme;
    const pill = theme.bg("selectedBg", theme.fg("dim", CLOSE_PILL));
    const gap = Math.max(0, width - visibleWidth(pill));
    return truncateToWidth(`${" ".repeat(gap)}${pill}`, width, "", true);
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.escape) ||
      matchesKey(data, Key.ctrl("c")) ||
      matchesKey(data, Key.enter) ||
      data === "q" ||
      data === "?"
    ) {
      this.opts.onDismiss();
    }
  }

  invalidate(): void {
    return;
  }
}

function blankLine(inner: number): string {
  return `│${" ".repeat(inner)}│`;
}

function borderTop(theme: Theme, inner: number, title: string): string {
  const styled = theme.fg("dim", ` ${theme.bold(title)} `);
  const titleWidth = visibleWidth(styled);
  const left = Math.max(0, Math.floor((inner - titleWidth) / 2));
  const right = Math.max(0, inner - titleWidth - left);
  return (
    theme.fg("dim", `╭${"─".repeat(left)}`) +
    styled +
    theme.fg("dim", `${"─".repeat(right)}╮`)
  );
}

function borderBottom(theme: Theme, inner: number): string {
  return theme.fg("dim", `╰${"─".repeat(inner)}╯`);
}

function contentLine(
  theme: Theme,
  inner: number,
  pad: number,
  content: string,
): string {
  const line =
    " ".repeat(pad) +
    truncateToWidth(content, Math.max(0, inner - pad * 2), "", true) +
    " ".repeat(pad);
  return theme.fg("dim", "│") + line + theme.fg("dim", "│");
}

/** Width of the aligned key column: longest key row across all groups. */
function computeKeyColumn(groups: ShortcutGroup[]): number {
  return Math.max(
    ...groups.flatMap((group) =>
      group.rows.map((row) => visibleWidth(row.keys)),
    ),
    1,
  );
}

/**
 * Natural panel width for a group list: key column + gap + longest
 * description, plus padding and borders, clamped to sane bounds.
 */
export function computeShortcutsOverlayWidth(groups: ShortcutGroup[]): number {
  const keyColumn = computeKeyColumn(groups);
  const longest = Math.max(
    ...groups.flatMap((group) =>
      group.rows.map(
        (row) => keyColumn + KEY_COLUMN_GAP - 1 + visibleWidth(row.description),
      ),
    ),
    1,
  );
  return Math.min(
    MAX_OVERLAY_WIDTH,
    Math.max(MIN_OVERLAY_WIDTH, longest + PANEL_PADDING * 2 + 2),
  );
}

/**
 * Push the shortcuts overlay onto the TUI overlay stack. Returns a disposer
 * that hides it; safe to call more than once.
 */
export function showShortcutsOverlay(
  tui: TUI,
  options: Omit<ShortcutsOverlayOptions, "onDismiss">,
): () => void {
  let handle: OverlayHandle | null = null;
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    handle?.hide();
    tui.requestRender();
  };

  const component = new ShortcutsOverlayComponent({
    ...options,
    onDismiss: dismiss,
  });

  handle = tui.showOverlay(component, {
    anchor: "center",
    width: computeShortcutsOverlayWidth(options.groups),
    maxHeight: "80%",
    margin: 2,
  });

  return dismiss;
}
