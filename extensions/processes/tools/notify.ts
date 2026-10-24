import {
  MAX_LOG_MATCH_PATTERN_LENGTH,
  MAX_LOG_MATCHERS_PER_PROCESS,
} from "../../../src/manager/log-matchers";
import type { LogMatcherSpec, ProcessWakeConfig } from "../../../src/wake";
import { DEFAULT_WAKE_ATTENTION } from "../../../src/wake";
import type { NotifyParamsType } from "./schema";

export const MAX_NOTIFY_LOG_MATCHERS = MAX_LOG_MATCHERS_PER_PROCESS;
export const MAX_NOTIFY_PATTERN_LENGTH = MAX_LOG_MATCH_PATTERN_LENGTH;

// Input arrives already validated against the TypeBox schema in ./schema.ts
// (Pi validates tool call arguments before execute). Only semantic checks the
// schema cannot express remain here: whitespace-only patterns (would match
// every line) and regex validity.

export function normalizeNotifyConfig(
  input: NotifyParamsType | undefined,
): ProcessWakeConfig {
  if (!input) {
    return { ...DEFAULT_WAKE_ATTENTION, logMatches: [] };
  }

  return {
    onSuccess: input.onSuccess ?? DEFAULT_WAKE_ATTENTION.onSuccess,
    onFailure: input.onFailure ?? DEFAULT_WAKE_ATTENTION.onFailure,
    onKilled: input.onKilled ?? DEFAULT_WAKE_ATTENTION.onKilled,
    logMatches: normalizeLogMatches(input.logMatches ?? [], {
      actionLabel: "process start",
      pathPrefix: "notify.logMatches",
    }),
  };
}

export function normalizeLogMatchItems(
  input: LogMatcherSpec[],
  options: {
    actionLabel: string;
    pathPrefix: string;
  },
): LogMatcherSpec[] {
  return input.map((entry, index) => normalizeLogMatch(entry, index, options));
}

function normalizeLogMatches(
  input: LogMatcherSpec[],
  options: { actionLabel: string; pathPrefix: string },
): LogMatcherSpec[] {
  return input.map((entry, index) => normalizeLogMatch(entry, index, options));
}

function normalizeLogMatch(
  input: LogMatcherSpec,
  index: number,
  options: { actionLabel: string; pathPrefix: string },
): LogMatcherSpec {
  const path = `${options.pathPrefix}[${index}]`;

  // An empty or whitespace-only literal pattern matches every line
  // (String#includes("")), and an empty regex matches every line too. Reject
  // early so a stray "" from the model does not fire a notification per line.
  if (input.pattern.trim().length === 0) {
    throw new Error(
      `${options.actionLabel} ${path}.pattern must not be empty or whitespace-only`,
    );
  }

  const mode = input.mode ?? "literal";

  if (mode === "regex") {
    validateRegex(input.pattern, path);
  }

  return {
    pattern: input.pattern,
    mode,
    stream: input.stream ?? "both",
    repeat: input.repeat ?? false,
    on: input.on ?? "turn",
  };
}

function validateRegex(pattern: string, path: string): void {
  try {
    new RegExp(pattern);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${path}.pattern is not a valid regular expression: ${message}`,
    );
  }
}
