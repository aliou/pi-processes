/**
 * Strip ANSI escape codes and other terminal control characters from a string.
 *
 * Removes:
 * - All CSI sequences (\x1b[...X) - SGR, cursor movement, erase, scroll, etc.
 * - OSC sequences (\x1b]...\x07 or \x1b]...\x1b\\)
 * - APC sequences (\x1b_...\x07 or \x1b_...\x1b\\)
 * - Remaining C0 control chars except tab/newline
 */
const ESC = String.fromCodePoint(0x001b);
const BEL = String.fromCodePoint(0x0007);

const ANSI_REPLACEMENTS: RegExp[] = [
  // CSI sequences: SGR, cursor movement, erase, scroll, etc.
  new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "gu"),
  // OSC sequences: ESC]...<BEL> or ESC]...<ESC>\\.
  new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "gu"),
  // APC sequences: ESC_...<BEL> or ESC_...<ESC>\\.
  new RegExp(`${ESC}_[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "gu"),
];

// Strip C0 terminal control characters that can corrupt TUI layout when
// rendered back into pi, such as carriage return and backspace. Keep tabs and
// newlines because logs use them as printable whitespace/line breaks.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this regex intentionally targets terminal control characters.
const TERMINAL_CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/gu;

/**
 * Check if a string contains ANSI escape codes.
 */
export function hasAnsi(str: string): boolean {
  return str.includes(ESC);
}

export function stripAnsi(str: string): string {
  let clean = str;

  if (str.includes(ESC)) {
    for (const pattern of ANSI_REPLACEMENTS) {
      clean = clean.replace(pattern, "");
    }
  }

  return clean.replace(TERMINAL_CONTROL_CHARS, "");
}
