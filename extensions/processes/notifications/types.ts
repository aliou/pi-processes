import type {
  ProcessEndReason,
  ProcessSignalInfo,
  ProcessStatus,
} from "../../../src/types";

export type Attention = "turn" | "context" | "ignore";

export type ProcessNotificationKind =
  | "success"
  | "failure"
  | "crash"
  | "killed"
  | "timeout"
  | "log_match";

export interface ProcessNotificationLogMatchDetails {
  pattern: string;
  mode: "literal" | "regex";
  stream: "stdout" | "stderr";
  line: string;
  matcherIndex: number;
}

export interface ProcessNotificationDetails {
  kind: ProcessNotificationKind;
  processId: string;
  processName: string;
  command: string;
  timestamp: number;
  summary: string;
  status?: ProcessStatus;
  exitCode?: number | null;
  endReason?: ProcessEndReason | null;
  signal?: ProcessSignalInfo | null;
  logMatch?: ProcessNotificationLogMatchDetails;
  attention: Attention;
}
