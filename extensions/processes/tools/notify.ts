import { isRecord } from "../../../src/utils/is-record";
import {
  MAX_LOG_MATCH_PATTERN_LENGTH,
  MAX_LOG_MATCHERS_PER_PROCESS,
} from "../notifications/log-matchers";
import type { LogMatcherConfig, NotifyConfig } from "../notifications/registry";
import type { Attention } from "../notifications/types";

const ATTENTIONS = ["turn", "context", "ignore"] as const;
const LOG_MATCH_MODES = ["literal", "regex"] as const;
const LOG_MATCH_STREAMS = ["stdout", "stderr", "both"] as const;

export const MAX_NOTIFY_LOG_MATCHERS = MAX_LOG_MATCHERS_PER_PROCESS;
export const MAX_NOTIFY_PATTERN_LENGTH = MAX_LOG_MATCH_PATTERN_LENGTH;

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

export function normalizeNotifyConfig(input: unknown): NotifyConfig {
  if (input === undefined || input === null) {
    return { ...DEFAULT_NOTIFY_CONFIG, logMatches: [] };
  }

  if (!isRecord(input)) {
    throw new Error("process start notify must be an object");
  }

  const logMatches = input.logMatches;

  return {
    onSuccess:
      normalizeAttention(input.onSuccess, "notify.onSuccess") ??
      DEFAULT_NOTIFY_CONFIG.onSuccess,
    onFailure:
      normalizeAttention(input.onFailure, "notify.onFailure") ??
      DEFAULT_NOTIFY_CONFIG.onFailure,
    onKilled:
      normalizeAttention(input.onKilled, "notify.onKilled") ??
      DEFAULT_NOTIFY_CONFIG.onKilled,
    logMatches: normalizeLogMatches(logMatches),
  };
}

function normalizeLogMatches(input: unknown): LogMatcherConfig[] {
  if (input === undefined || input === null) return [];

  if (!Array.isArray(input)) {
    throw new Error("process start notify.logMatches must be an array");
  }

  if (input.length > MAX_NOTIFY_LOG_MATCHERS) {
    throw new Error(
      `process start notify.logMatches supports at most ${MAX_NOTIFY_LOG_MATCHERS} matchers`,
    );
  }

  return input.map((entry, index) => normalizeLogMatch(entry, index));
}

export function normalizeLogMatchItems(
  input: unknown,
  options: {
    actionLabel: string;
    pathPrefix: string;
    maxItems?: number;
  },
): LogMatcherConfig[] {
  const { actionLabel, pathPrefix } = options;
  const maxItems = options.maxItems ?? MAX_NOTIFY_LOG_MATCHERS;

  if (input === undefined || input === null) {
    throw new Error(`${actionLabel} ${pathPrefix} is required`);
  }

  if (!Array.isArray(input)) {
    throw new Error(`${actionLabel} ${pathPrefix} must be an array`);
  }

  if (input.length === 0) {
    throw new Error(`${actionLabel} ${pathPrefix} must not be empty`);
  }

  if (input.length > maxItems) {
    throw new Error(
      `${actionLabel} ${pathPrefix} supports at most ${maxItems} items`,
    );
  }

  return input.map((entry, index) =>
    normalizeLogMatch(entry, index, { actionLabel, pathPrefix }),
  );
}

export function normalizeLogMatch(
  input: unknown,
  index: number,
  options?: { actionLabel?: string; pathPrefix?: string },
): LogMatcherConfig {
  const actionLabel = options?.actionLabel ?? "process start";
  const path = `${options?.pathPrefix ?? "notify.logMatches"}[${index}]`;

  if (!isRecord(input)) {
    throw new Error(`${actionLabel} ${path} must be an object`);
  }

  if (typeof input.pattern !== "string") {
    throw new Error(`${actionLabel} ${path}.pattern must be a string`);
  }

  // An empty or whitespace-only literal pattern matches every line
  // (String#includes("")), and an empty regex matches every line too. Reject
  // early so a stray "" from the model does not fire a notification per line.
  if (input.pattern.trim().length === 0) {
    throw new Error(
      `${actionLabel} ${path}.pattern must not be empty or whitespace-only`,
    );
  }

  if (input.pattern.length > MAX_NOTIFY_PATTERN_LENGTH) {
    throw new Error(
      `${actionLabel} ${path}.pattern must be at most ${MAX_NOTIFY_PATTERN_LENGTH} characters`,
    );
  }

  const mode =
    normalizeStringEnum(input.mode, LOG_MATCH_MODES, `${path}.mode`) ??
    "literal";
  const stream =
    normalizeStringEnum(input.stream, LOG_MATCH_STREAMS, `${path}.stream`) ??
    "both";
  const repeat = normalizeBoolean(input.repeat, `${path}.repeat`) ?? false;
  const on = normalizeAttention(input.on, `${path}.on`) ?? "turn";

  if (mode === "regex") {
    validateRegex(input.pattern, path);
  }

  return {
    pattern: input.pattern,
    mode,
    stream,
    repeat,
    on,
  };
}

function normalizeAttention(
  input: unknown,
  path: string,
): Attention | undefined {
  return normalizeStringEnum(input, ATTENTIONS, path);
}

function normalizeStringEnum<const T extends readonly string[]>(
  input: unknown,
  allowed: T,
  path: string,
): T[number] | undefined {
  if (input === undefined || input === null) return undefined;

  if (typeof input !== "string" || !allowed.includes(input)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}`);
  }

  return input;
}

function normalizeBoolean(input: unknown, path: string): boolean | undefined {
  if (input === undefined || input === null) return undefined;

  if (typeof input !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }

  return input;
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
