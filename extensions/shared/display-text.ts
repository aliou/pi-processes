/**
 * Make untrusted process output safe to render in the TUI.
 *
 * This module lives outside pi-agnostic `src/` because tab expansion needs the
 * Pi TUI width measurement to stay in sync with what the renderer computes.
 */

import { visibleWidth } from "@earendil-works/pi-tui";

const ESC = String.fromCodePoint(0x001b);
const BEL = String.fromCodePoint(0x0007);
const ST = String.fromCodePoint(0x009c);
const RESET = `${ESC}[0m`;

// Control characters a single display row must never contain. Tabs are handled
// separately; newlines are dropped because they would shift the whole frame.
// C1 controls are included: a raw \u009b is an alias for CSI on some terminals.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex intentionally targets terminal control characters.
const DISPLAY_CONTROL_CHARS = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/gu;

// SGR parameters we consider safe to keep: colors and attributes only.
const SGR_PARAMS = /^[0-9;:]*$/u;

// Terminals advance tabs to the next 8-column stop, but the TUI measures a tab
// as a fixed width. Expanding here keeps measured width and drawn width equal.
const TAB_WIDTH = 8;

/**
 * Sanitize one line of terminal output for display while keeping its colors.
 *
 * Keeps SGR sequences (`ESC[...m`) and drops everything else: cursor
 * movement, erase, scroll regions, alternate screen switches, OSC/DCS/APC
 * strings (terminated or not), charset designators, lone escapes, newlines,
 * and C0/C1 control characters. Tabs are expanded to spaces. Those are the
 * inputs that corrupt the screen, because they either act on the real
 * terminal or make width measurement disagree with what the terminal draws.
 *
 * A trailing reset is appended when any SGR survives so colors cannot bleed
 * into the rest of the frame.
 */
export function sanitizeForDisplay(text: string): string {
  if (!text.includes(ESC)) return cleanPlainText(text, 0).text;

  let out = "";
  let cursor = 0;
  let column = 0;
  let keptSgr = false;

  while (cursor < text.length) {
    const escapeAt = text.indexOf(ESC, cursor);
    if (escapeAt === -1) {
      out += cleanPlainText(text.slice(cursor), column).text;
      break;
    }
    const chunk = cleanPlainText(text.slice(cursor, escapeAt), column);
    out += chunk.text;
    column = chunk.column;

    const sequence = readEscapeSequence(text, escapeAt);
    if (sequence.isSgr) {
      out += text.slice(escapeAt, sequence.end);
      keptSgr = true;
    }
    cursor = sequence.end;
  }

  if (!keptSgr || out.endsWith(RESET)) return out;
  return `${out}${RESET}`;
}

/**
 * Drop control characters and expand tabs, starting from `column` so tab stops
 * line up across the chunks of a line split by escape sequences. Columns are
 * measured in terminal cells, so wide and zero-width characters land right.
 */
function cleanPlainText(
  text: string,
  column: number,
): { text: string; column: number } {
  const clean = text.replace(DISPLAY_CONTROL_CHARS, "");
  if (!clean.includes("\t")) {
    return { text: clean, column: column + visibleWidth(clean) };
  }

  const parts = clean.split("\t");
  let out = parts[0] ?? "";
  let col = column + visibleWidth(out);
  for (const part of parts.slice(1)) {
    const spaces = TAB_WIDTH - (col % TAB_WIDTH);
    out += " ".repeat(spaces) + part;
    col += spaces + visibleWidth(part);
  }
  return { text: out, column: col };
}

/**
 * Find the end of the escape sequence starting at `start` (which must point at
 * an ESC) and report whether it is a plain SGR sequence.
 *
 * Unterminated sequences swallow the rest of the string: a terminal would do
 * the same, so dropping the tail is what keeps the screen intact.
 */
function readEscapeSequence(
  text: string,
  start: number,
): { end: number; isSgr: boolean } {
  const next = text[start + 1];
  if (next === undefined) return { end: text.length, isSgr: false };

  if (next === "[") return readControlSequence(text, start);

  // OSC (]) and APC (_): standard terminator is ST, but BEL is widely used
  // for both in practice (pi's own cursor marker included), so accept it.
  if (next === "]" || next === "_") {
    return { end: findStringTerminator(text, start + 2, true), isSgr: false };
  }

  // DCS (P), SOS (X), PM (^): ST only. A BEL inside a sixel payload is data.
  if (next === "P" || next === "X" || next === "^") {
    return { end: findStringTerminator(text, start + 2, false), isSgr: false };
  }

  // Sequences with one intermediate byte: charset designators (ESC ( B),
  // ESC % G, ESC # 8, and friends.
  if (next >= "\u0020" && next <= "\u002f") {
    return { end: Math.min(start + 3, text.length), isSgr: false };
  }

  // Everything else is a two-byte escape: ESC c (reset), ESC 7/8, ESC =, ...
  return { end: start + 2, isSgr: false };
}

/** Index just past the terminator of a string sequence, else end of input. */
function findStringTerminator(
  text: string,
  from: number,
  allowBel: boolean,
): number {
  for (let index = from; index < text.length; index++) {
    if (allowBel && text[index] === BEL) return index + 1;
    if (text[index] === ST) return index + 1;
    if (text[index] === ESC && text[index + 1] === "\\") return index + 2;
  }
  return text.length;
}

function readControlSequence(
  text: string,
  start: number,
): { end: number; isSgr: boolean } {
  let index = start + 2;
  const paramStart = index;
  while (
    index < text.length &&
    text[index] >= "\u0030" &&
    text[index] <= "\u003f"
  ) {
    index++;
  }
  const paramEnd = index;
  while (
    index < text.length &&
    text[index] >= "\u0020" &&
    text[index] <= "\u002f"
  ) {
    index++;
  }
  const hasIntermediates = index > paramEnd;
  const final = text[index];
  if (final === undefined || final < "\u0040" || final > "\u007e") {
    return { end: text.length, isSgr: false };
  }

  const isSgr =
    final === "m" &&
    !hasIntermediates &&
    SGR_PARAMS.test(text.slice(paramStart, paramEnd));
  return { end: index + 1, isSgr };
}
