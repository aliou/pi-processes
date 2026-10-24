import type { ProcessAttention, ProcessInfo } from "./types";
import type { LINE_MATCH_MODES } from "./utils/match-line";

export const LOG_MATCH_STREAMS = ["stdout", "stderr", "both"] as const;

type LineMatchMode = (typeof LINE_MATCH_MODES)[number];
type LogMatcherStream = (typeof LOG_MATCH_STREAMS)[number];

export interface LogMatcherSpec {
  pattern: string;
  mode?: LineMatchMode;
  stream?: LogMatcherStream;
  repeat?: boolean;
  on?: ProcessAttention;
}

export interface ProcessWakeConfig {
  onSuccess?: ProcessAttention;
  onFailure?: ProcessAttention;
  onKilled?: ProcessAttention;
  logMatches?: LogMatcherSpec[];
}

export type ProcessWakeWatch = LogMatcherSpec & { fired: boolean };

export interface ProcessWakeConditions {
  exitAttention: {
    success: ProcessAttention;
    failure: ProcessAttention;
    killed: ProcessAttention;
  };
  watches: ProcessWakeWatch[];
}

export type ProcessListEntry = ProcessInfo & { wake?: ProcessWakeConditions };

export interface WatchRemoveSpec {
  index?: number;
  pattern?: string;
  mode?: LineMatchMode;
  stream?: LogMatcherStream;
  repeat?: boolean;
  on?: ProcessAttention;
}

export interface WatchMeta {
  revision: number;
  generation: number;
}

export interface WatchState {
  logMatches: LogMatcherSpec[];
  revision: number;
  generation: number;
}

export interface WatchUpdateResult {
  logMatches: LogMatcherSpec[];
  revision: number;
  generation: number;
}

export const DEFAULT_WAKE_ATTENTION = {
  // Builds, tests, and other one-shot commands are started because the agent
  // needs the result, so success defaults to a turn. Long-running servers
  // rarely exit 0, and callers that only need the result as future context can
  // pass onSuccess: "context". External kills (outside this manager) surface
  // as context by default so the agent and user learn that a managed process
  // disappeared. Intentional stops via the tool/command path are classified
  // separately and never reach this branch.
  onSuccess: "turn",
  onFailure: "turn",
  onKilled: "context",
} as const satisfies Pick<
  ProcessWakeConfig,
  "onSuccess" | "onFailure" | "onKilled"
>;

export type WakeAttentionField = "onSuccess" | "onFailure" | "onKilled";

export function resolveWakeAttention(
  field: WakeAttentionField,
  config: ProcessWakeConfig | null,
): ProcessAttention {
  return config?.[field] ?? DEFAULT_WAKE_ATTENTION[field];
}
