import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, type TSchema, Type } from "typebox";
import { KILL_FAILURE_REASONS, ProcessInfoSchema } from "../../../src/types";
import { LINE_MATCH_MODES } from "../../../src/utils/match-line";
import { PROCESS_PROTOCOL_ATTENTIONS } from "../../shared/protocol";
import {
  LOG_MATCH_STREAMS,
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
  mode: Type.Optional(StringEnum(LINE_MATCH_MODES)),
  stream: Type.Optional(StringEnum(LOG_MATCH_STREAMS)),
  repeat: Type.Optional(Type.Boolean()),
  on: Type.Optional(StringEnum(PROCESS_PROTOCOL_ATTENTIONS)),
  index: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Matcher to remove; takes precedence over pattern.",
    }),
  ),
  pattern: Type.Optional(
    Type.String({
      maxLength: MAX_NOTIFY_PATTERN_LENGTH,
      description: "Required for append and replace.",
    }),
  ),
});

export const NotifyParams = Type.Object(NotifyConfigSchema.properties, {
  description:
    "Notify settings. Attention: turn wakes or steers the agent; context persists immediately without waking or steering the agent (mid-run, pi appends it after the current tool results); ignore suppresses successful exits and external kills but retains log matches as context. Failures always notify, with ignore downgraded to context. Keep turn for anything whose result you need immediately.",
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
      description: "Defaults to the agent's working directory. Only for start.",
    }),
  ),
  notify: Type.Optional(NotifyParams),
  id: Type.Optional(
    Type.String({
      description:
        "ID from start or list, not the name. Required for stop, output, write, and update.",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Only for list." })),
  sortBy: Type.Optional(
    StringEnum(PROCESS_LIST_SORTS, {
      description: "Only for list.",
    }),
  ),
  statuses: Type.Optional(
    Type.Array(StringEnum(PROCESS_LIST_STATUS_FILTERS), {
      description:
        "Only for list. finished: exited successfully; failed: exited unsuccessfully or terminate_timeout.",
    }),
  ),
  stream: Type.Optional(
    StringEnum(PROCESS_OUTPUT_STREAMS, {
      description: "Defaults to both. Only for output.",
    }),
  ),
  tailLines: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_OUTPUT_TAIL_LINES,
      description: "Lines per stream. Defaults to 100. Only for output.",
    }),
  ),
  pattern: Type.Optional(
    Type.String({
      maxLength: MAX_OUTPUT_PATTERN_LENGTH,
      description:
        "Line filter, literal unless mode is regex. Only for output.",
    }),
  ),
  input: Type.Optional(
    Type.String({
      description: "Text for stdin. Only for write.",
    }),
  ),
  end: Type.Optional(
    Type.Boolean({
      description: "Close stdin after writing (EOF). Only for write.",
    }),
  ),
  mode: Type.Optional(
    StringEnum(PROCESS_OUTPUT_MATCH_MODES, {
      description: "Defaults to literal. Only for output.",
    }),
  ),
  watches: Type.Optional(
    Type.Object(
      {
        mode: StringEnum(PROCESS_WATCH_UPDATE_MODES),
        items: Type.Optional(
          Type.Array(WatchUpdateItemParams, {
            maxItems: MAX_NOTIFY_LOG_MATCHERS,
            description:
              "Same fields as notify.logMatches. Full matchers for append and replace; index or pattern for remove.",
          }),
        ),
      },
      {
        description: "Only for update.",
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

const DECLARATION_OMITTED_KEYWORDS = new Set([
  "description",
  "maxItems",
  "maxLength",
]);

function toDeclaration(schema: TSchema): TSchema {
  return JSON.parse(JSON.stringify(schema), (keyword, value) => {
    if (DECLARATION_OMITTED_KEYWORDS.has(keyword) && typeof value !== "object")
      return undefined;
    return keyword === "type" && value === "integer" ? "number" : value;
  });
}

export const ProcessToolOutputDeclaration = Type.Unsafe<ProcessToolOutput>(
  toDeclaration(ProcessToolOutputSchema),
);
