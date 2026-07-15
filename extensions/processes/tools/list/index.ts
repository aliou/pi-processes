import type { ProcessManager } from "../../../../src/manager";
import { LIVE_STATUSES, type ProcessInfo } from "../../../../src/types";
import type {
  LogMatcherConfig,
  NotificationRegistry,
} from "../../notifications/registry";
import type {
  ProcessesParamsType,
  ProcessListSort,
  ProcessListStatusFilter,
} from "../schema";
import { formatProcessRuntime } from "../utils";
import { formatPatternsForModel } from "../watch-format";

/**
 * A process plus its duration computed when the list was produced.
 *
 * For stopped processes this is the actual run duration (endTime - startTime).
 * For running processes it is measured against the list call's reference time.
 */
export interface ListProcess extends ProcessInfo {
  duration: string;
  watches: LogMatcherConfig[];
}

export interface ListDetails {
  action: "list";
  processes: ListProcess[];
  filters: {
    limit: number | null;
    sortBy: ProcessListSort;
    statuses: ProcessListStatusFilter[];
  };
  counts: ProcessListCounts;
}

export interface ProcessListCounts {
  running: number;
  exited: number;
  failed: number;
  killed: number;
  total: number;
}

export function executeList(
  manager: ProcessManager,
  params: ProcessesParamsType,
  notifications: NotificationRegistry,
): ListDetails {
  const filters = resolveListFilters(params);
  const allProcesses = manager.list();
  const filtered = allProcesses
    .filter((process) => matchesStatusFilter(process, filters.statuses))
    .sort((a, b) => compareProcesses(a, b, filters.sortBy));

  const limited =
    filters.limit === null ? filtered : filtered.slice(0, filters.limit);

  // Capture the reference time after listing so every process in `limited`
  // has startTime <= now (avoids negative durations for just-spawned ones).
  const now = Date.now();
  const processes: ListProcess[] = limited.map((process) => ({
    ...process,
    duration: formatProcessRuntime(process, now),
    watches: LIVE_STATUSES.has(process.status)
      ? (notifications.getWatchState(process.id)?.logMatches ?? [])
      : [],
  }));

  return {
    action: "list",
    processes,
    filters,
    counts: countProcesses(processes),
  };
}

export function formatListDetails(details: ListDetails): string {
  if (details.processes.length === 0) {
    return "No matching background processes.";
  }

  return details.processes
    .map(
      (process) =>
        `${process.id}\t${process.status}\t${process.name}\t${process.command}\t${process.stdoutFile}\t${process.stderrFile}\tpatterns=${formatPatternsForModel(process.watches)}`,
    )
    .join("\n");
}

function resolveListFilters(
  params: ProcessesParamsType,
): ListDetails["filters"] {
  return {
    limit: params.limit && params.limit > 0 ? Math.floor(params.limit) : null,
    sortBy: params.sortBy ?? "startTime_desc",
    statuses:
      params.statuses && params.statuses.length > 0 ? params.statuses : ["all"],
  };
}

function matchesStatusFilter(
  process: ProcessInfo,
  filters: ProcessListStatusFilter[],
): boolean {
  if (filters.includes("all")) return true;

  return filters.some((filter) => {
    if (filter === "finished") {
      return process.status === "exited" && process.success === true;
    }

    if (filter === "failed") {
      return (
        process.status === "terminate_timeout" ||
        (process.status === "exited" && process.success === false)
      );
    }

    return process.status === filter;
  });
}

function compareProcesses(
  a: ProcessInfo,
  b: ProcessInfo,
  sortBy: ProcessListSort,
): number {
  switch (sortBy) {
    case "startTime_asc":
      return a.startTime - b.startTime;
    case "name_asc":
      return a.name.localeCompare(b.name);
    case "name_desc":
      return b.name.localeCompare(a.name);
    case "status_asc":
      return a.status.localeCompare(b.status);
    case "startTime_desc":
      return b.startTime - a.startTime;
  }
}

function countProcesses(processes: ProcessInfo[]): ProcessListCounts {
  return {
    running: processes.filter((process) => process.status === "running").length,
    exited: processes.filter(
      (process) => process.status === "exited" && process.success === true,
    ).length,
    failed: processes.filter(
      (process) =>
        process.status === "terminate_timeout" ||
        (process.status === "exited" && process.success === false),
    ).length,
    killed: processes.filter((process) => process.status === "killed").length,
    total: processes.length,
  };
}
