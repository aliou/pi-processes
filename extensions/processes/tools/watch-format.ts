import type { LogMatcherSpec } from "../../../src/wake";

export function formatMatcherForModel(matcher: LogMatcherSpec): string {
  const mode = matcher.mode ?? "literal";
  const stream = matcher.stream ?? "both";
  const repeat = matcher.repeat ? " (repeat)" : "";
  const on = matcher.on ?? "turn";

  return `[${stream}] ${mode} ${on}${repeat} ${JSON.stringify(matcher.pattern)}`;
}

export function formatPatternsForModel(matchers: LogMatcherSpec[]): string {
  return JSON.stringify(matchers.map((matcher) => matcher.pattern));
}
