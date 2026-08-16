import {
  MAX_LOG_MATCH_PATTERN_LENGTH,
  MAX_LOG_MATCHERS_PER_PROCESS,
} from "../notifications/log-matchers";
import type { LogMatcherConfig, NotifyConfig } from "../notifications/registry";
import type { NotifyLogMatchParamsType, NotifyParamsType } from "./schema";

const DEFAULT_NOTIFY_CONFIG = {
  // A backgrounded process usually outlives the turn that started it, and
  // "context" only reaches the agent if it happens to still be streaming when
  // the process ends. Builds, tests, and other one-shot commands are started
  // precisely because the agent needs the result, so success defaults to a
  // turn. Long-running servers rarely exit 0, and callers that do not want the
  // interruption can pass onSuccess: "context".
  onSuccess: "turn",
  onFailure: "turn",
  // External kills (outside this manager) surface as context by default so
  // the agent and user learn that a managed process disappeared. Intentional
  // stops via the tool/command path are classified separately and never reach
  // this branch.
  onKilled: "context",
} as const satisfies Pick<NotifyConfig, "onSuccess" | "onFailure" | "onKilled">;

export const MAX_NOTIFY_LOG_MATCHERS = MAX_LOG_MATCHERS_PER_PROCESS;
export const MAX_NOTIFY_PATTERN_LENGTH = MAX_LOG_MATCH_PATTERN_LENGTH;

// Input arrives already validated against the TypeBox schema in ./schema.ts
// (Pi validates tool call arguments before execute). Only semantic checks the
// schema cannot express remain here: whitespace-only patterns (would match
// every line) and regex validity.

export function normalizeNotifyConfig(
  input: NotifyParamsType | undefined,
): NotifyConfig {
  if (!input) {
    return { ...DEFAULT_NOTIFY_CONFIG, logMatches: [] };
  }

  return {
    onSuccess: input.onSuccess ?? DEFAULT_NOTIFY_CONFIG.onSuccess,
    onFailure: input.onFailure ?? DEFAULT_NOTIFY_CONFIG.onFailure,
    onKilled: input.onKilled ?? DEFAULT_NOTIFY_CONFIG.onKilled,
    logMatches: normalizeLogMatches(input.logMatches ?? [], {
      actionLabel: "process start",
      pathPrefix: "notify.logMatches",
    }),
  };
}

export function normalizeLogMatchItems(
  input: NotifyLogMatchParamsType[],
  options: {
    actionLabel: string;
    pathPrefix: string;
  },
): LogMatcherConfig[] {
  return input.map((entry, index) => normalizeLogMatch(entry, index, options));
}

function normalizeLogMatches(
  input: NotifyLogMatchParamsType[],
  options: { actionLabel: string; pathPrefix: string },
): LogMatcherConfig[] {
  return input.map((entry, index) => normalizeLogMatch(entry, index, options));
}

function normalizeLogMatch(
  input: NotifyLogMatchParamsType,
  index: number,
  options: { actionLabel: string; pathPrefix: string },
): LogMatcherConfig {
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
