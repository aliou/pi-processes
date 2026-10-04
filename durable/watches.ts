import { stripAnsi } from "../src/utils/ansi";
import { compileLineMatcher } from "../src/utils/match-line";
import type { LogWatch, WatchChange } from "./schema";

export interface Watch {
  config: LogWatch;
  matches: (line: string) => boolean;
  fired: boolean;
  lastMatch: number;
}

export interface WatchMatch {
  index: number;
  pattern: string;
  stream: "stdout" | "stderr";
  line: string;
  attention: "turn" | "context" | "ignore";
}

export function compileWatches(configs: LogWatch[]): Watch[] {
  if (configs.length > 20)
    throw new Error("At most 20 log watches are allowed");
  return configs.map((config) => ({
    config: { ...config },
    matches: compileLineMatcher(config.pattern, config.mode ?? "literal"),
    fired: false,
    lastMatch: -Infinity,
  }));
}

function canMatch(watch: Watch, now: number): boolean {
  if (!watch.fired) return true;
  if (!watch.config.repeat) return false;
  return now - watch.lastMatch >= 15_000;
}

function matchWatch(
  watch: Watch,
  index: number,
  appended: Array<{ type: "stdout" | "stderr"; text: string }>,
): WatchMatch | null {
  for (const entry of appended) {
    const stream = watch.config.stream ?? "both";
    if (stream !== "both" && stream !== entry.type) continue;
    const lines = entry.text.split("\n");
    for (const raw of lines) {
      if (raw.length > 10_000) continue;
      const line = stripAnsi(raw.split("\r").at(-1) ?? "");
      if (!line || !watch.matches(line)) continue;
      return {
        index,
        pattern: watch.config.pattern,
        stream: entry.type,
        line,
        attention: watch.config.on ?? "turn",
      };
    }
  }
  return null;
}

export function evaluateWatches(
  watches: Watch[],
  appended: Array<{ type: "stdout" | "stderr"; text: string }>,
  now: number,
): WatchMatch[] {
  const matches: WatchMatch[] = [];
  for (const [index, watch] of watches.entries()) {
    if (!canMatch(watch, now)) continue;
    const match = matchWatch(watch, index, appended);
    if (!match) continue;
    watch.fired = true;
    watch.lastMatch = now;
    matches.push(match);
  }
  return matches;
}

function removeMatch(
  watch: Watch,
  index: number,
  spec: NonNullable<WatchChange["items"]>[number],
): boolean {
  if (spec.index !== undefined) return spec.index === index;
  if (spec.pattern !== watch.config.pattern) return false;
  const defaults = {
    mode: "literal",
    stream: "both",
    repeat: false,
    on: "turn",
  } as const;
  return (Object.keys(defaults) as Array<keyof typeof defaults>).every(
    (key) =>
      spec[key] === undefined ||
      spec[key] === (watch.config[key] ?? defaults[key]),
  );
}

export function changeWatches(watches: Watch[], change: WatchChange): Watch[] {
  if (change.mode === "clear") return [];
  const items = change.items ?? [];
  if (change.mode === "remove") {
    if (items.some((item) => item.index === undefined && !item.pattern))
      throw new Error("Watch removal requires an index or pattern");
    return watches.filter(
      (watch, index) => !items.some((item) => removeMatch(watch, index, item)),
    );
  }
  const configs = items.map((item): LogWatch => {
    if (!item.pattern) throw new Error("Watch requires a pattern");
    const { index: _index, ...config } = item;
    return { ...config, pattern: item.pattern };
  });
  const compiled = compileWatches(configs);
  const next = change.mode === "append" ? [...watches, ...compiled] : compiled;
  if (next.length > 20) throw new Error("At most 20 log watches are allowed");
  return next;
}
