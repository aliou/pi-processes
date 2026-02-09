/**
 * Strip ANSI escape codes from a string.
 *
 * Removes:
 * - All CSI sequences (\x1b[...X) - SGR, cursor movement, erase, scroll, etc.
 * - OSC 8 hyperlinks (\x1b]8;;URL\x07)
 * - APC sequences (\x1b_...\x07 or \x1b_...\x1b\\)
 */
/**
 * Check if a string contains ANSI escape codes.
 */
export function hasAnsi(str: string): boolean {
  return str.includes(String.fromCodePoint(0x001b));
}

export function stripAnsi(str: string): string {
  // ESC = \u001b, BEL = \u0007
  const ESC = String.fromCodePoint(0x001b);
  const BEL = String.fromCodePoint(0x0007);

  if (!str.includes(ESC)) {
    return str;
  }

  // Strip all CSI sequences (ESC[...X where X is any letter)
  let clean = str.replace(new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, "gu"), "");
  // Strip OSC 8 hyperlinks: ESC]8;;URL<BEL> and ESC]8;;<BEL>
  clean = clean.replace(new RegExp(`${ESC}\\]8;;[^${BEL}]*${BEL}`, "gu"), "");
  // Strip APC sequences: ESC_...<BEL> or ESC_...<ESC>\\ (used for cursor marker)
  clean = clean.replace(
    new RegExp(`${ESC}_[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "gu"),
    "",
  );

  return clean;
}
