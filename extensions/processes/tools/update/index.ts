import type { ProcessManager } from "../../../../src/manager";
import type { ProcessInfo } from "../../../../src/types";
import { LIVE_STATUSES } from "../../../../src/types";
import type {
  LogMatcherConfig,
  NotificationRegistry,
  WatchRemoveSpec,
  WatchUpdateResult,
} from "../../notifications/registry";
import { normalizeLogMatchItems } from "../notify";
import type { ProcessesParamsType } from "../schema";

export interface UpdateDetails {
  action: "update";
  ok: boolean;
  error?: string;
  process?: ProcessInfo;
  renamed: boolean;
  previousName: string | null;
  watches: {
    mode: "append" | "replace" | "remove" | "clear" | null;
    before: LogMatcherConfig[];
    applied: LogMatcherConfig[];
    count: number;
    items: LogMatcherConfig[];
  };
}

export function executeUpdate(
  params: ProcessesParamsType,
  manager: ProcessManager,
  notifications: NotificationRegistry,
): UpdateDetails {
  if (!params.id) {
    return {
      action: "update",
      ok: false,
      error: "process update requires id",
      renamed: false,
      previousName: null,
      watches: { mode: null, before: [], applied: [], count: 0, items: [] },
    };
  }

  const before = manager.get(params.id);
  if (!before) {
    return {
      action: "update",
      ok: false,
      error: `process not found: ${params.id}`,
      renamed: false,
      previousName: null,
      watches: { mode: null, before: [], applied: [], count: 0, items: [] },
    };
  }

  if (!LIVE_STATUSES.has(before.status)) {
    return {
      action: "update",
      ok: false,
      error: `process update requires a running process; ${params.id} has status ${before.status}`,
      process: before,
      renamed: false,
      previousName: null,
      watches: { mode: null, before: [], applied: [], count: 0, items: [] },
    };
  }

  let process = before;
  let renamed = false;
  let previousName: string | null = null;

  if (params.name !== undefined) {
    const name = params.name.trim();
    if (!name) {
      return {
        action: "update",
        ok: false,
        error: "process update name must be non-empty",
        process: before,
        renamed: false,
        previousName: null,
        watches: { mode: null, before: [], applied: [], count: 0, items: [] },
      };
    }

    const renamedProcess = manager.rename(params.id, name);
    if (!renamedProcess) {
      return {
        action: "update",
        ok: false,
        error: `process not found: ${params.id}`,
        renamed: false,
        previousName: null,
        watches: { mode: null, before: [], applied: [], count: 0, items: [] },
      };
    }

    renamed = before.name !== renamedProcess.name;
    if (renamed) {
      previousName = before.name;
    }
    process = renamedProcess;
  }

  let watchError: string | undefined;
  const watchesBefore =
    notifications.getWatchState(params.id)?.logMatches ?? [];
  let watchesApplied: LogMatcherConfig[] = [];
  const watchResult = applyWatchUpdate(
    params.id,
    params.watches,
    notifications,
  );

  if (params.watches && !watchResult) {
    watchError = `process update could not update watches for ${params.id}`;
  }

  if (watchResult) {
    watchesApplied =
      params.watches?.mode === "append" || params.watches?.mode === "replace"
        ? watchResult.logMatches.slice(
            params.watches.mode === "append" ? watchesBefore.length : 0,
          )
        : [];
  }

  const currentWatches =
    watchResult?.logMatches ??
    notifications.getWatchState(params.id)?.logMatches ??
    [];

  if (watchError) {
    return {
      action: "update",
      ok: false,
      error: watchError,
      process,
      renamed,
      previousName,
      watches: {
        mode: params.watches?.mode ?? null,
        before: watchesBefore,
        applied: [],
        count: currentWatches.length,
        items: currentWatches,
      },
    };
  }

  return {
    action: "update",
    ok: true,
    process,
    renamed,
    previousName,
    watches: {
      mode: params.watches?.mode ?? null,
      before: watchesBefore,
      applied: watchesApplied,
      count: currentWatches.length,
      items: currentWatches,
    },
  };
}

function applyWatchUpdate(
  processId: string,
  watches: ProcessesParamsType["watches"],
  notifications: NotificationRegistry,
): WatchUpdateResult | null {
  if (!watches) return null;

  const { mode } = watches;

  if (mode === "clear") {
    return notifications.clearWatches(processId);
  }

  const items = watches.items;
  if (!items || items.length === 0) {
    throw new Error(
      `process update watches.items is required for mode=${mode}`,
    );
  }

  if (mode === "append" || mode === "replace") {
    const normalized = normalizeLogMatchItems(items, {
      actionLabel: "process update",
      pathPrefix: "watches.items",
    });

    return mode === "append"
      ? notifications.appendWatches(processId, normalized)
      : notifications.replaceWatches(processId, normalized);
  }

  if (mode === "remove") {
    const specs = normalizeWatchRemoveSpecs(items);
    return notifications.removeWatches(processId, specs);
  }

  throw new Error(`unsupported watch update mode: ${String(mode)}`);
}

interface RawRemoveItem {
  index?: number;
  pattern?: string;
  mode?: string;
  stream?: string;
  repeat?: boolean;
  on?: string;
}

function normalizeWatchRemoveSpecs(items: unknown[]): WatchRemoveSpec[] {
  return items.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error(
        `process update watches.items[${index}] must be an object`,
      );
    }

    const item = raw as RawRemoveItem;

    if (item.index !== undefined) {
      if (
        typeof item.index !== "number" ||
        !Number.isInteger(item.index) ||
        item.index < 0
      ) {
        throw new Error(
          `process update watches.items[${index}].index must be a non-negative integer`,
        );
      }

      return { index: item.index };
    }

    if (item.pattern !== undefined) {
      if (typeof item.pattern !== "string") {
        throw new Error(
          `process update watches.items[${index}].pattern must be a string`,
        );
      }

      if (item.pattern.trim().length === 0) {
        throw new Error(
          `process update watches.items[${index}].pattern must not be empty`,
        );
      }

      if (item.mode === "regex") {
        try {
          new RegExp(item.pattern);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            `process update watches.items[${index}].pattern is not a valid regular expression: ${message}`,
          );
        }
      }

      return {
        pattern: item.pattern,
        mode: item.mode as WatchRemoveSpec["mode"],
        stream: item.stream as WatchRemoveSpec["stream"],
        repeat: item.repeat,
        on: item.on as WatchRemoveSpec["on"],
      };
    }

    throw new Error(
      `process update watches.items[${index}] requires either index or pattern for remove mode`,
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatUpdateDetails(details: UpdateDetails): string {
  if (!details.ok) {
    return details.error ?? "process update failed";
  }

  const parts: string[] = [];

  if (details.renamed && details.previousName && details.process) {
    parts.push(
      `Renamed process from "${details.previousName}" to "${details.process.name}" (${details.process.id}).`,
    );
  } else if (details.process) {
    parts.push(
      `Updated process ${details.process.name} (${details.process.id}).`,
    );
  }

  const { mode, applied, before, count } = details.watches;

  if (mode === "append") {
    parts.push(
      `Appended ${applied.length} watch${applied.length === 1 ? "" : "es"}; ${count} active.`,
    );
  } else if (mode === "replace") {
    parts.push(
      `Replaced ${before.length} with ${applied.length} watch${applied.length === 1 ? "" : "es"}; ${count} active.`,
    );
  } else if (mode === "remove") {
    const removed = before.length - count;
    parts.push(
      `Removed ${removed} watch${removed === 1 ? "" : "es"}; ${count} active.`,
    );
  } else if (mode === "clear") {
    parts.push(
      `Cleared ${before.length} watch${before.length === 1 ? "" : "es"}; ${count} active.`,
    );
  }

  return parts.join(" ") || "Updated process.";
}
