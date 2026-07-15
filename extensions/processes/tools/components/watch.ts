import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import type { LogMatcherConfig } from "../../notifications/registry";

export function buildMatcherLine(
  matcher: LogMatcherConfig,
  theme: Theme,
  prefix = "",
): Text {
  const mode = matcher.mode ?? "literal";
  const stream = matcher.stream ?? "both";
  const repeat = matcher.repeat ? " (repeat)" : "";
  const on = matcher.on ?? "turn";
  const attentionTone =
    on === "turn" ? "warning" : on === "context" ? "success" : "muted";

  return new Text(
    [
      prefix,
      theme.fg("muted", `[${stream}] ${mode}`),
      "  ",
      theme.bold(theme.fg(attentionTone, `${on}${repeat}`)),
      "  ",
      theme.fg("accent", formatPatternForDisplay(matcher.pattern)),
    ].join(""),
    0,
    0,
  );
}

export function formatPatternForDisplay(pattern: string): string {
  let formatted = "";

  for (const character of pattern) {
    if (character === "\r") {
      formatted += "\\r";
    } else if (character === "\n") {
      formatted += "\\n";
    } else if (character === "\t") {
      formatted += "\\t";
    } else {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
        formatted += `\\x${codePoint.toString(16).padStart(2, "0")}`;
      } else {
        formatted += character;
      }
    }
  }

  return formatted;
}
