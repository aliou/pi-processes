import type { LogMatcherConfig } from "../notifications/registry";

export function formatMatcherForModel(matcher: LogMatcherConfig): string {
  const mode = matcher.mode ?? "literal";
  const stream = matcher.stream ?? "both";
  const repeat = matcher.repeat ? " (repeat)" : "";
  const on = matcher.on ?? "turn";

  return `[${stream}] ${mode} ${on}${repeat} ${JSON.stringify(matcher.pattern)}`;
}

export function formatPatternsForModel(matchers: LogMatcherConfig[]): string {
  return JSON.stringify(matchers.map((matcher) => matcher.pattern));
}
