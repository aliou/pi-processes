import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

import { MAX_NOTIFY_LOG_MATCHERS, MAX_NOTIFY_PATTERN_LENGTH } from "./notify";

export const PROCESS_LIST_STATUS_FILTERS = [
  "all",
  "running",
  "finished",
  "failed",
  "terminating",
  "terminate_timeout",
  "killed",
] as const;

export const PROCESS_LIST_SORTS = [
  "startTime_desc",
  "startTime_asc",
  "name_asc",
  "name_desc",
  "status_asc",
] as const;

export const PROCESS_NOTIFY_ATTENTIONS = ["turn", "context", "ignore"] as const;
export const PROCESS_NOTIFY_LOG_MATCH_MODES = ["literal", "regex"] as const;
export const PROCESS_NOTIFY_LOG_MATCH_STREAMS = [
  "stdout",
  "stderr",
  "both",
] as const;

const NotifyLogMatchParams = Type.Object({
  pattern: Type.String({
    maxLength: MAX_NOTIFY_PATTERN_LENGTH,
    description:
      "Log pattern to match. Limited to 500 characters. Literal by default; regex only when mode is regex.",
  }),
  mode: Type.Optional(
    StringEnum(PROCESS_NOTIFY_LOG_MATCH_MODES, {
      description: "Pattern matching mode. Defaults to literal.",
    }),
  ),
  stream: Type.Optional(
    StringEnum(PROCESS_NOTIFY_LOG_MATCH_STREAMS, {
      description: "Output stream to inspect. Defaults to both.",
    }),
  ),
  repeat: Type.Optional(
    Type.Boolean({
      description:
        "Whether this matcher can notify more than once. Defaults to false.",
    }),
  ),
  on: Type.Optional(
    StringEnum(PROCESS_NOTIFY_ATTENTIONS, {
      description: "Agent attention for this log match. Defaults to turn.",
    }),
  ),
});

const NotifyParams = Type.Object({
  onSuccess: Type.Optional(
    StringEnum(PROCESS_NOTIFY_ATTENTIONS, {
      description:
        "Agent attention when the process exits successfully. Defaults to context.",
    }),
  ),
  onFailure: Type.Optional(
    StringEnum(PROCESS_NOTIFY_ATTENTIONS, {
      description:
        "Agent attention when the process fails or crashes. Defaults to turn.",
    }),
  ),
  onKilled: Type.Optional(
    StringEnum(PROCESS_NOTIFY_ATTENTIONS, {
      description:
        "Agent attention when the process is killed. Defaults to ignore.",
    }),
  ),
  logMatches: Type.Optional(
    Type.Array(NotifyLogMatchParams, {
      maxItems: MAX_NOTIFY_LOG_MATCHERS,
      description:
        "Log match notifications. Supports at most 20 matchers, with each pattern limited to 500 characters.",
    }),
  ),
});

export const ProcessesParams = Type.Object({
  action: StringEnum(["start", "list", "stop"] as const, {
    description: "Action to perform.",
  }),
  name: Type.Optional(
    Type.String({ description: "Process name. Required for start." }),
  ),
  command: Type.Optional(
    Type.String({ description: "Shell command to run. Required for start." }),
  ),
  notify: Type.Optional(NotifyParams),
  id: Type.Optional(
    Type.String({ description: "Process id. Required for stop." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of processes to list." }),
  ),
  sortBy: Type.Optional(
    StringEnum(PROCESS_LIST_SORTS, {
      description: "Sort order for process list results.",
    }),
  ),
  statuses: Type.Optional(
    Type.Array(StringEnum(PROCESS_LIST_STATUS_FILTERS), {
      description:
        "Process list status filters. Use all for no filtering; finished means exited successfully; failed means exited unsuccessfully or terminate_timeout.",
    }),
  ),
});

export type ProcessesParamsType = Static<typeof ProcessesParams>;

export type ProcessAction = ProcessesParamsType["action"];
export type ProcessListStatusFilter =
  (typeof PROCESS_LIST_STATUS_FILTERS)[number];
export type ProcessListSort = (typeof PROCESS_LIST_SORTS)[number];
export type ProcessNotifyAttention = (typeof PROCESS_NOTIFY_ATTENTIONS)[number];
export type ProcessNotifyLogMatchMode =
  (typeof PROCESS_NOTIFY_LOG_MATCH_MODES)[number];
export type ProcessNotifyLogMatchStream =
  (typeof PROCESS_NOTIFY_LOG_MATCH_STREAMS)[number];
