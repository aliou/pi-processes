import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

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
