import type {
  ProcessEndReason,
  ProcessSignalInfo,
  ProcessStatus,
} from "../types";

/**
 * Notification event payload broadcast on {@link CHANNELS.NOTIFICATION}.
 *
 * This is the protocol-safe mirror of the core extension's
 * `ProcessNotificationDetails`. It is intentionally free of Pi imports so UI
 * extensions (logs, dock) can observe notification events without importing
 * core notification internals. The core extension emits this payload; the core
 * delivery listener converts it back into a persisted custom message, while UI
 * extensions use it for highlighting (e.g. log-match markers).
 */
export type ProcessProtocolAttention = "turn" | "context" | "ignore";

export type ProcessProtocolNotificationKind =
  | "success"
  | "failure"
  | "crash"
  | "killed"
  | "log_match"
  | "log_match_suppressed";

export interface ProcessProtocolNotificationLogMatch {
  pattern: string;
  mode: "literal" | "regex";
  stream: "stdout" | "stderr";
  line: string;
  matcherIndex: number;
}

export interface ProcessProtocolNotificationPayload {
  kind: ProcessProtocolNotificationKind;
  processId: string;
  processName: string;
  command: string;
  timestamp: number;
  summary: string;
  status?: ProcessStatus;
  exitCode?: number | null;
  endReason?: ProcessEndReason | null;
  signal?: ProcessSignalInfo | null;
  logMatch?: ProcessProtocolNotificationLogMatch;
  attention: ProcessProtocolAttention;
}
