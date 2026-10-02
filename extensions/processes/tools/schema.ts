import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { KILL_FAILURE_REASONS, ProcessInfoSchema } from "../../../src/types";
import { LINE_MATCH_MODES } from "../../../src/utils/match-line";
import {
  LogMatcherConfigSchema,
  NotifyConfigSchema,
} from "../notifications/registry";
import { MAX_NOTIFY_LOG_MATCHERS, MAX_NOTIFY_PATTERN_LENGTH } from "./notify";

// --- Output action constants ---

export const DEFAULT_OUTPUT_TAIL_LINES = 100;
export const MAX_OUTPUT_TAIL_LINES = 2000;
export const MAX_OUTPUT_SCAN_LINES = 5000;
export const MAX_OUTPUT_BYTES = 50 * 1024;
export const MAX_OUTPUT_PATTERN_LENGTH = MAX_NOTIFY_PATTERN_LENGTH;

export const PROCESS_OUTPUT_STREAMS = ["stdout", "stderr", "both"] as const;

export const PROCESS_OUTPUT_MATCH_MODES = LINE_MATCH_MODES;

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

const WatchUpdateItemParams = Type.Object({
  ...LogMatcherConfigSchema.properties,
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
});

export const NotifyParams = Type.Object(NotifyConfigSchema.properties, {
  description:
    "Notify settings. Attention: turn wakes or steers the agent; context persists immediately without waking or steering the agent (mid-run, pi appends it after the current tool results); ignore suppresses successful exits and external kills but retains log matches as context. Failures always notify, with ignore downgraded to context.",
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

export type NotifyParamsType = Static<typeof NotifyParams>;

export type ProcessAction = ProcessesParamsType["action"];
export type ProcessListStatusFilter =
  (typeof PROCESS_LIST_STATUS_FILTERS)[number];
export type ProcessListSort = (typeof PROCESS_LIST_SORTS)[number];

export type ProcessOutputStream = (typeof PROCESS_OUTPUT_STREAMS)[number];
export type ProcessOutputMatchMode =
  (typeof PROCESS_OUTPUT_MATCH_MODES)[number];
export type ProcessWatchUpdateMode =
  (typeof PROCESS_WATCH_UPDATE_MODES)[number];

// --- Structured output ---

const KillResultSchema = Type.Union([
  Type.Object({
    ok: Type.Literal(true),
    info: ProcessInfoSchema,
  }),
  Type.Object({
    ok: Type.Literal(false),
    info: ProcessInfoSchema,
    reason: StringEnum(KILL_FAILURE_REASONS),
  }),
]);

const OutputTruncationSchema = Type.Object({
  truncated: Type.Boolean(),
  truncatedBy: Type.Union([
    Type.Literal("lines"),
    Type.Literal("bytes"),
    Type.Null(),
  ]),
  totalLines: Type.Integer(),
  totalBytes: Type.Integer(),
  outputLines: Type.Integer(),
  outputBytes: Type.Integer(),
  lastLinePartial: Type.Boolean(),
  firstLineExceedsLimit: Type.Boolean(),
  maxLines: Type.Integer(),
  maxBytes: Type.Integer(),
});

const ProcessStartOutputSchema = Type.Object({
  action: Type.Literal("start"),
  process: ProcessInfoSchema,
  notify: NotifyConfigSchema,
});
export type StartDetails = Static<typeof ProcessStartOutputSchema>;

const ListProcessSchema = Type.Object({
  ...ProcessInfoSchema.properties,
  duration: Type.String(),
  watches: Type.Array(LogMatcherConfigSchema),
});
export type ListProcess = Static<typeof ListProcessSchema>;

const ListCountsSchema = Type.Object({
  running: Type.Integer(),
  exited: Type.Integer(),
  failed: Type.Integer(),
  killed: Type.Integer(),
  total: Type.Integer(),
});
export type ProcessListCounts = Static<typeof ListCountsSchema>;

const ProcessListOutputSchema = Type.Object({
  action: Type.Literal("list"),
  processes: Type.Array(ListProcessSchema),
  filters: Type.Object({
    limit: Type.Union([Type.Number(), Type.Null()]),
    sortBy: StringEnum(PROCESS_LIST_SORTS),
    statuses: Type.Array(StringEnum(PROCESS_LIST_STATUS_FILTERS)),
  }),
  counts: ListCountsSchema,
});
export type ListDetails = Static<typeof ProcessListOutputSchema>;

const ProcessStopOutputSchema = Type.Object({
  action: Type.Literal("stop"),
  result: KillResultSchema,
});
export type StopDetails = Static<typeof ProcessStopOutputSchema>;

const ProcessWriteOutputSchema = Type.Object({
  action: Type.Literal("write"),
  id: Type.String(),
  processName: Type.String(),
  process: Type.Union([ProcessInfoSchema, Type.Null()]),
  bytes: Type.Integer(),
  end: Type.Boolean(),
  ok: Type.Boolean(),
  reason: Type.Union([Type.String(), Type.Null()]),
});
export type WriteDetails = Static<typeof ProcessWriteOutputSchema>;

const ProcessUpdateOutputSchema = Type.Object({
  action: Type.Literal("update"),
  ok: Type.Boolean(),
  error: Type.Optional(Type.String()),
  process: Type.Optional(ProcessInfoSchema),
  renamed: Type.Boolean(),
  previousName: Type.Union([Type.String(), Type.Null()]),
  watches: Type.Object({
    mode: Type.Union([StringEnum(PROCESS_WATCH_UPDATE_MODES), Type.Null()]),
    before: Type.Array(LogMatcherConfigSchema),
    applied: Type.Array(LogMatcherConfigSchema),
    count: Type.Integer(),
    items: Type.Array(LogMatcherConfigSchema),
  }),
});
export type UpdateDetails = Static<typeof ProcessUpdateOutputSchema>;

const ProcessClearOutputSchema = Type.Object({
  action: Type.Literal("clear"),
  cleared: Type.Integer(),
});
export type ClearDetails = Static<typeof ProcessClearOutputSchema>;

const ProcessOutputSchema = Type.Object({
  action: Type.Literal("output"),
  id: Type.String(),
  processName: Type.String(),
  processStatus: Type.String(),
  stream: StringEnum(PROCESS_OUTPUT_STREAMS),
  tailLines: Type.Integer(),
  pattern: Type.Union([Type.String(), Type.Null()]),
  mode: StringEnum(PROCESS_OUTPUT_MATCH_MODES),
  stdoutFile: Type.String(),
  stderrFile: Type.String(),
  stdout: Type.Array(Type.String(), {
    description:
      "Raw filtered stdout lines behind the model-facing preview. Bounded by tailLines and the 5000-line scan window, not by the preview byte limit.",
  }),
  stderr: Type.Array(Type.String(), {
    description:
      "Raw filtered stderr lines behind the model-facing preview. Bounded by tailLines and the 5000-line scan window, not by the preview byte limit.",
  }),
  truncation: Type.Optional(OutputTruncationSchema),
});

export type OutputDetails = Omit<
  Static<typeof ProcessOutputSchema>,
  "stdout" | "stderr"
>;
export type ProcessOutput = Static<typeof ProcessOutputSchema>;

export const ProcessToolOutputSchema = Type.Union(
  [
    ProcessStartOutputSchema,
    ProcessListOutputSchema,
    ProcessStopOutputSchema,
    ProcessWriteOutputSchema,
    ProcessUpdateOutputSchema,
    ProcessClearOutputSchema,
    ProcessOutputSchema,
  ],
  {
    description:
      "Structured payload returned by every process tool action, discriminated by action.",
  },
);
export type ProcessToolOutput = Static<typeof ProcessToolOutputSchema>;
