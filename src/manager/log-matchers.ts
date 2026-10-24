import type { ProcessAttention, WatchMatch } from "../types";
import { stripAnsi } from "../utils/ansi";
import { compileLineMatcher } from "../utils/match-line";
import type { ProcessWakeConfig } from "../wake";

export interface CompiledLogMatcher {
  pattern: string;
  mode: "literal" | "regex";
  stream: "stdout" | "stderr" | "both";
  repeat: boolean;
  on: ProcessAttention;
  lineMatcher: ((line: string) => boolean) | null;
  matcherIndex: number;
  fired: boolean;
  lastMatchTime: number;
}

export const MAX_LOG_MATCHERS_PER_PROCESS = 20;
export const MAX_LOG_MATCH_PATTERN_LENGTH = 500;
const MAX_LINE_LENGTH = 10_000;
const LOG_MATCH_COOLDOWN_MS = 15_000;
const TAB_WIDTH = 8;

export function compileLogMatchers(
  config: ProcessWakeConfig,
): CompiledLogMatcher[] {
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

    let lineMatcher: ((line: string) => boolean) | null = null;

    if (mode === "regex") {
      try {
        lineMatcher = compileLineMatcher(entry.pattern, mode);
      } catch (_error) {
        void _error; // Invalid regex: skip this matcher
        continue;
      }
    } else {
      lineMatcher = compileLineMatcher(entry.pattern, mode);
    }

    matchers.push({
      pattern: entry.pattern,
      mode,
      stream,
      repeat,
      on,
      lineMatcher,
      matcherIndex: i,
      fired: false,
      lastMatchTime: 0,
    });
  }

  return matchers;
}

export function evaluateLogMatchers(
  matchers: CompiledLogMatcher[],
  appendedText: Array<{ type: "stdout" | "stderr"; text: string }>,
  now: number,
): WatchMatch[] {
  const results: WatchMatch[] = [];

  const lines = splitAppendedIntoLines(appendedText);

  for (const matcher of matchers) {
    if (!matcher.repeat && matcher.fired) continue;

    if (
      matcher.repeat &&
      matcher.fired &&
      now - matcher.lastMatchTime < LOG_MATCH_COOLDOWN_MS
    ) {
      continue;
    }

    for (const line of lines) {
      if (!streamMatches(matcher.stream, line.type)) continue;
      if (line.text.length > MAX_LINE_LENGTH) continue;

      const matched = matcher.lineMatcher?.(line.text);

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
      // Match the same per-line visible text the log views render. This keeps
      // CR-overwritten progress and invisible escape bytes from firing
      // watches, without making watches depend on viewport width.
      const displayLine = plainTextForLogLine(line);
      if (displayLine.length === 0) continue;
      lines.push({ type: entry.type, text: displayLine });
    }
  }

  return lines;
}

function plainTextForLogLine(line: string): string {
  const carriageReturn = line.lastIndexOf("\r");
  const visible = carriageReturn === -1 ? line : line.slice(carriageReturn + 1);
  const clean = stripAnsi(visible);
  if (!clean.includes("\t")) return clean;
  return expandTabs(clean);
}

function expandTabs(text: string): string {
  let out = "";
  let column = 0;
  for (const ch of text) {
    if (ch === "\t") {
      const spaces = TAB_WIDTH - (column % TAB_WIDTH);
      out += " ".repeat(spaces);
      column += spaces;
      continue;
    }
    out += ch;
    column += 1;
  }
  return out;
}

function streamMatches(
  matcherStream: "stdout" | "stderr" | "both",
  lineStream: "stdout" | "stderr",
): boolean {
  return matcherStream === "both" || matcherStream === lineStream;
}
