import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

import { MAX_NOTIFY_LOG_MATCHERS, MAX_NOTIFY_PATTERN_LENGTH } from "./notify";

// --- Output action constants ---

export const DEFAULT_OUTPUT_TAIL_LINES = 100;
export const MAX_OUTPUT_TAIL_LINES = 2000;
export const MAX_OUTPUT_SCAN_LINES = 5000;
export const MAX_OUTPUT_BYTES = 50 * 1024;
export const MAX_OUTPUT_PATTERN_LENGTH = MAX_NOTIFY_PATTERN_LENGTH;

export const PROCESS_OUTPUT_STREAMS = ["stdout", "stderr", "both"] as const;

export const PROCESS_OUTPUT_MATCH_MODES = ["literal", "regex"] as const;

export const PROCESS_WATCH_UPDATE_MODES = [
  "append",
  "replace",
  "remove",
  "clear",
] as const;

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

const WatchUpdateItemParams = Type.Object({
  index: Type.Optional(
    Type.Integer({
      minimum: 0,
      description:
        "Matcher index to remove. Only for remove mode. If pattern is also provided, index takes precedence.",
    }),
  ),
  pattern: Type.Optional(
    Type.String({
      maxLength: MAX_NOTIFY_PATTERN_LENGTH,
      description:
        "Log pattern. Required for append and replace modes. Optional for remove mode (use index or pattern).",
    }),
  ),
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
        "Agent attention when the process is killed. Defaults to context.",
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
  action: StringEnum(
    ["start", "list", "stop", "output", "write", "update", "clear"] as const,
    {
      description: "Action to perform.",
    },
  ),
  name: Type.Optional(
    Type.String({ description: "Process name. Required for start." }),
  ),
  command: Type.Optional(
    Type.String({ description: "Shell command to run. Required for start." }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Working directory for start. Defaults to the agent's current working directory. Only for start.",
    }),
  ),
  notify: Type.Optional(NotifyParams),
  id: Type.Optional(
    Type.String({
      description:
        "Opaque process ID returned by start or list (for example, proc_ab12). Required for stop, output, write, and update. Process names are not accepted.",
    }),
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
  stream: Type.Optional(
    StringEnum(PROCESS_OUTPUT_STREAMS, {
      description:
        "Output stream to return. Defaults to both. Only for output action.",
    }),
  ),
  tailLines: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_OUTPUT_TAIL_LINES,
      description:
        "Maximum matching lines to return per selected stream. Defaults to 100. Only for output action.",
    }),
  ),
  pattern: Type.Optional(
    Type.String({
      maxLength: MAX_OUTPUT_PATTERN_LENGTH,
      description:
        "Optional output filter. Literal by default; regex only when mode is regex. Only for output action.",
    }),
  ),
  input: Type.Optional(
    Type.String({
      description:
        "Text to write to the process stdin. Only for write action. Defaults to an empty string when closing stdin with end.",
    }),
  ),
  end: Type.Optional(
    Type.Boolean({
      description:
        "Close stdin after writing. Use to signal end-of-input (EOF). Only for write action.",
    }),
  ),
  mode: Type.Optional(
    StringEnum(PROCESS_OUTPUT_MATCH_MODES, {
      description:
        "Pattern matching mode for output filter. Defaults to literal. Only for output action.",
    }),
  ),
  watches: Type.Optional(
    Type.Object(
      {
        mode: StringEnum(PROCESS_WATCH_UPDATE_MODES, {
          description: "How to update log watches.",
        }),
        items: Type.Optional(
          Type.Array(WatchUpdateItemParams, {
            maxItems: MAX_NOTIFY_LOG_MATCHERS,
            description:
              "Watch entries. For append/replace, provide full matcher definitions. For remove, provide index or pattern to identify matchers to remove. Ignored for clear.",
          }),
        ),
      },
      {
        description:
          "Update log watches on a running process. Only for update action.",
      },
    ),
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

export type ProcessOutputStream = (typeof PROCESS_OUTPUT_STREAMS)[number];
export type ProcessOutputMatchMode =
  (typeof PROCESS_OUTPUT_MATCH_MODES)[number];
export type ProcessWatchUpdateMode =
  (typeof PROCESS_WATCH_UPDATE_MODES)[number];
