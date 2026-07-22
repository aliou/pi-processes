import {
  DEFAULT_MAX_BACKGROUND_POLL_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_UNIFIED_EXEC_PROCESSES,
  UNIFIED_EXEC_OUTPUT_MAX_BYTES,
} from "../constants";
import type { CodexExecProtocolConfig } from "./types";

/**
 * Resolved defaults. Every value mirrors a codex constant; the only non-codex
 * value is `enabled: false` (a host-repo gate, not a codex semantic).
 */
export const DEFAULT_CONFIG: CodexExecProtocolConfig = {
  enabled: false,
  sessions: {
    maxSessions: MAX_UNIFIED_EXEC_PROCESSES,
    maxBackgroundPollMs: DEFAULT_MAX_BACKGROUND_POLL_MS,
  },
  output: {
    maxBytes: UNIFIED_EXEC_OUTPUT_MAX_BYTES,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  },
};
