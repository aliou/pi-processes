import type {
  ProcessAttention,
  ProcessEndReason,
  ProcessSignalInfo,
  ProcessStatus,
} from "../../../src/types";
import { PROCESS_ATTENTIONS } from "../../../src/types";
import type {
  ProcessWakeConditions,
  ProcessWakeWatch,
} from "../../../src/wake";

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
export type ProcessProtocolAttention = ProcessAttention;

export const PROCESS_PROTOCOL_ATTENTIONS = PROCESS_ATTENTIONS;

export type {
  ProcessWakeConditions as ProcessProtocolWakeConditions,
  ProcessWakeWatch as ProcessProtocolWakeWatch,
};

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
  sessionIdle?: boolean;
}
