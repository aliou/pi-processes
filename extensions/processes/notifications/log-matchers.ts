import type { NotifyConfig } from "./registry";
import type { Attention } from "./types";

export interface CompiledLogMatcher {
  pattern: string;
  mode: "literal" | "regex";
  stream: "stdout" | "stderr" | "both";
  repeat: boolean;
  on: Attention;
  regex: RegExp | null;
  matcherIndex: number;
  fired: boolean;
  lastMatchTime: number;
}

export const MAX_LOG_MATCHERS_PER_PROCESS = 20;
export const MAX_LOG_MATCH_PATTERN_LENGTH = 500;
const MAX_LINE_LENGTH = 10_000;
const LOG_MATCH_COOLDOWN_MS = 5000;

export function compileLogMatchers(config: NotifyConfig): CompiledLogMatcher[] {
  const raw = config.logMatches;
  if (!raw || raw.length === 0) return [];

  const matchers: CompiledLogMatcher[] = [];

  for (let i = 0; i < Math.min(raw.length, MAX_LOG_MATCHERS_PER_PROCESS); i++) {
    const entry = raw[i];

    if (entry.pattern.length > MAX_LOG_MATCH_PATTERN_LENGTH) {
      continue;
    }

    const mode = entry.mode ?? "literal";
    const stream = entry.stream ?? "both";
    const repeat = entry.repeat ?? false;
    const on = entry.on ?? "turn";

    let regex: RegExp | null = null;

    if (mode === "regex") {
      try {
        regex = new RegExp(entry.pattern);
      } catch (_error) {
        void _error; // Invalid regex: skip this matcher
        continue;
      }
    }

    matchers.push({
      pattern: entry.pattern,
      mode,
      stream,
      repeat,
      on,
      regex,
      matcherIndex: i,
      fired: false,
      lastMatchTime: 0,
    });
  }

  return matchers;
}

export interface LogMatchResult {
  matcherIndex: number;
  pattern: string;
  mode: "literal" | "regex";
  stream: "stdout" | "stderr";
  line: string;
  on: Attention;
}

export function evaluateLogMatchers(
  matchers: CompiledLogMatcher[],
  appendedText: Array<{ type: "stdout" | "stderr"; text: string }>,
  now: number,
): LogMatchResult[] {
  const results: LogMatchResult[] = [];

  const lines = splitAppendedIntoLines(appendedText);

  for (const matcher of matchers) {
    if (!matcher.repeat && matcher.fired) continue;

    if (
      matcher.repeat &&
      matcher.lastMatchTime > 0 &&
      now - matcher.lastMatchTime < LOG_MATCH_COOLDOWN_MS
    ) {
      continue;
    }

    for (const line of lines) {
      if (!streamMatches(matcher.stream, line.type)) continue;
      if (line.text.length > MAX_LINE_LENGTH) continue;

      const matched =
        matcher.mode === "literal"
          ? line.text.includes(matcher.pattern)
          : matcher.regex?.test(line.text);

      if (matched) {
        matcher.fired = true;
        matcher.lastMatchTime = now;

        results.push({
          matcherIndex: matcher.matcherIndex,
          pattern: matcher.pattern,
          mode: matcher.mode,
          stream: line.type,
          line: line.text,
          on: matcher.on,
        });

        break;
      }
    }
  }

  return results;
}

function splitAppendedIntoLines(
  appended: Array<{ type: "stdout" | "stderr"; text: string }>,
): Array<{ type: "stdout" | "stderr"; text: string }> {
  const lines: Array<{ type: "stdout" | "stderr"; text: string }> = [];

  for (const entry of appended) {
    const split = entry.text.split("\n");
    for (const line of split) {
      if (line.length === 0) continue;
      lines.push({ type: entry.type, text: line });
    }
  }

  return lines;
}

function streamMatches(
  matcherStream: "stdout" | "stderr" | "both",
  lineStream: "stdout" | "stderr",
): boolean {
  return matcherStream === "both" || matcherStream === lineStream;
}
