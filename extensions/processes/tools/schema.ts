import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  arr,
  bool,
  int,
  nullable,
  num,
  obj,
  oneOf,
  opt,
  type Schema,
  type Static,
  str,
  union,
  unsafe,
} from "@earendil-works/pi-schema";
import {
  KILL_FAILURE_REASONS,
  ProcessInfoSchema,
  processInfoProperties,
} from "../../../src/types";
import { LINE_MATCH_MODES } from "../../../src/utils/match-line";
import { PROCESS_PROTOCOL_ATTENTIONS } from "../../shared/protocol";
import {
  LOG_MATCH_STREAMS,
  LogMatcherConfigSchema,
  NotifyConfigSchema,
  notifyConfigProperties,
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

const WatchUpdateItemParams = obj({
  mode: opt(oneOf(LINE_MATCH_MODES)),
  stream: opt(oneOf(LOG_MATCH_STREAMS)),
  repeat: opt(bool()),
  on: opt(oneOf(PROCESS_PROTOCOL_ATTENTIONS)),
  index: opt(
    int({
      minimum: 0,
      description: "Matcher to remove; takes precedence over pattern.",
    }),
  ),
  pattern: opt(
    str({
      maxLength: MAX_NOTIFY_PATTERN_LENGTH,
      description: "Required for append and replace.",
    }),
  ),
});

export const NotifyParams = obj(notifyConfigProperties, {
  description:
    "Notify settings. Attention: turn wakes or steers the agent; context persists immediately without waking or steering the agent (mid-run, pi appends it after the current tool results); ignore suppresses successful exits and external kills but retains log matches as context. Failures always notify, with ignore downgraded to context. Keep turn for anything whose result you need immediately.",
});

export const ProcessesParams = obj({
  action: oneOf(
    ["start", "list", "stop", "output", "write", "update", "clear"] as const,
    {
      description: "Action to perform.",
    },
  ),
  name: opt(str({ description: "Process name. Required for start." })),
  command: opt(
    str({ description: "Shell command to run. Required for start." }),
  ),
  cwd: opt(
    str({
      description: "Defaults to the agent's working directory. Only for start.",
    }),
  ),
  notify: opt(NotifyParams),
  id: opt(
    str({
      description:
        "ID from start or list, not the name. Required for stop, output, write, and update.",
    }),
  ),
  limit: opt(num({ description: "Only for list." })),
  sortBy: opt(
    oneOf(PROCESS_LIST_SORTS, {
      description: "Only for list.",
    }),
  ),
  statuses: opt(
    arr(oneOf(PROCESS_LIST_STATUS_FILTERS), {
      description:
        "Only for list. finished: exited successfully; failed: exited unsuccessfully or terminate_timeout.",
    }),
  ),
  stream: opt(
    oneOf(PROCESS_OUTPUT_STREAMS, {
      description: "Defaults to both. Only for output.",
    }),
  ),
  tailLines: opt(
    int({
      minimum: 1,
      maximum: MAX_OUTPUT_TAIL_LINES,
      description: "Lines per stream. Defaults to 100. Only for output.",
    }),
  ),
  pattern: opt(
    str({
      maxLength: MAX_OUTPUT_PATTERN_LENGTH,
      description:
        "Line filter, literal unless mode is regex. Only for output.",
    }),
  ),
  input: opt(str({ description: "Text for stdin. Only for write." })),
  end: opt(
    bool({ description: "Close stdin after writing (EOF). Only for write." }),
  ),
  mode: opt(
    oneOf(PROCESS_OUTPUT_MATCH_MODES, {
      description: "Defaults to literal. Only for output.",
    }),
  ),
  watches: opt(
    obj(
      {
        mode: oneOf(PROCESS_WATCH_UPDATE_MODES),
        items: opt(
          arr(WatchUpdateItemParams, {
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

const KillResultSchema = union([
  obj({
    ok: oneOf([true]),
    info: ProcessInfoSchema,
  }),
  obj({
    ok: oneOf([false]),
    info: ProcessInfoSchema,
    reason: oneOf(KILL_FAILURE_REASONS),
  }),
]);

const OutputTruncationSchema = obj({
  truncated: bool(),
  truncatedBy: nullable(oneOf(["lines", "bytes"])),
  totalLines: int(),
  totalBytes: int(),
  outputLines: int(),
  outputBytes: int(),
  lastLinePartial: bool(),
  firstLineExceedsLimit: bool(),
  maxLines: int(),
  maxBytes: int(),
});

const ProcessStartOutputSchema = obj({
  action: oneOf(["start"]),
  process: ProcessInfoSchema,
  notify: NotifyConfigSchema,
});
export type StartDetails = Static<typeof ProcessStartOutputSchema>;

const ListProcessSchema = obj({
  ...processInfoProperties,
  duration: str(),
  watches: arr(LogMatcherConfigSchema),
});
export type ListProcess = Static<typeof ListProcessSchema>;

const ListCountsSchema = obj({
  running: int(),
  exited: int(),
  failed: int(),
  killed: int(),
  total: int(),
});
export type ProcessListCounts = Static<typeof ListCountsSchema>;

const ProcessListOutputSchema = obj({
  action: oneOf(["list"]),
  processes: arr(ListProcessSchema),
  filters: obj({
    limit: nullable(num()),
    sortBy: oneOf(PROCESS_LIST_SORTS),
    statuses: arr(oneOf(PROCESS_LIST_STATUS_FILTERS)),
  }),
  counts: ListCountsSchema,
});
export type ListDetails = Static<typeof ProcessListOutputSchema>;

const ProcessStopOutputSchema = obj({
  action: oneOf(["stop"]),
  result: KillResultSchema,
});
export type StopDetails = Static<typeof ProcessStopOutputSchema>;

const ProcessWriteOutputSchema = obj({
  action: oneOf(["write"]),
  id: str(),
  processName: str(),
  process: nullable(ProcessInfoSchema),
  bytes: int(),
  end: bool(),
  ok: bool(),
  reason: nullable(str()),
});
export type WriteDetails = Static<typeof ProcessWriteOutputSchema>;

const ProcessUpdateOutputSchema = obj({
  action: oneOf(["update"]),
  ok: bool(),
  error: opt(str()),
  process: opt(ProcessInfoSchema),
  renamed: bool(),
  previousName: nullable(str()),
  watches: obj({
    mode: nullable(oneOf(PROCESS_WATCH_UPDATE_MODES)),
    before: arr(LogMatcherConfigSchema),
    applied: arr(LogMatcherConfigSchema),
    count: int(),
    items: arr(LogMatcherConfigSchema),
  }),
});
export type UpdateDetails = Static<typeof ProcessUpdateOutputSchema>;

const ProcessClearOutputSchema = obj({
  action: oneOf(["clear"]),
  cleared: int(),
});
export type ClearDetails = Static<typeof ProcessClearOutputSchema>;

const ProcessOutputSchema = obj({
  action: oneOf(["output"]),
  id: str(),
  processName: str(),
  processStatus: str(),
  stream: oneOf(PROCESS_OUTPUT_STREAMS),
  tailLines: int(),
  pattern: nullable(str()),
  mode: oneOf(PROCESS_OUTPUT_MATCH_MODES),
  stdoutFile: str(),
  stderrFile: str(),
  stdout: arr(str(), {
    description:
      "Raw filtered stdout lines behind the model-facing preview. Bounded by tailLines and the 5000-line scan window, not by the preview byte limit.",
  }),
  stderr: arr(str(), {
    description:
      "Raw filtered stderr lines behind the model-facing preview. Bounded by tailLines and the 5000-line scan window, not by the preview byte limit.",
  }),
  truncation: opt(OutputTruncationSchema),
});

export type OutputDetails = Omit<
  Static<typeof ProcessOutputSchema>,
  "stdout" | "stderr"
>;
export type ProcessOutput = Static<typeof ProcessOutputSchema>;

export const ProcessToolOutputSchema = union(
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

function toDeclaration(schema: Schema): Schema {
  return JSON.parse(JSON.stringify(schema), (keyword, value) => {
    if (DECLARATION_OMITTED_KEYWORDS.has(keyword) && typeof value !== "object")
      return undefined;
    return keyword === "type" && value === "integer" ? "number" : value;
  });
}

export const ProcessToolParameters =
  ProcessesParams as unknown as ToolDefinition["parameters"];
export const ProcessToolOutputDeclaration = unsafe<ProcessToolOutput>(
  toDeclaration(ProcessToolOutputSchema),
) as unknown as NonNullable<ToolDefinition["outputSchema"]>;
