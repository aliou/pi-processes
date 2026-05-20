import { expect } from "vitest";
import type { ProcessManager } from "../../src/manager";
import {
  LIVE_STATUSES,
  type LogWatchMatchEvent,
  type ManagerEvent,
  type ProcessInfo,
} from "../../src/types";

declare module "vitest" {
  interface Matchers<T> {
    toHaveLine(
      events: ManagerEvent[],
      processId: string,
      line: string,
    ): T extends Promise<unknown> ? Promise<void> : Promise<void>;
  }
}

expect.extend({
  async toHaveLine(
    manager: ProcessManager,
    events: ManagerEvent[],
    processId: string,
    line: string,
  ) {
    try {
      await waitForWatchMatch(
        manager,
        events,
        processId,
        (match) => match.line === line,
      );

      return {
        pass: true,
        message: () =>
          `expected process ${processId} not to emit watched line ${this.utils.printExpected(line)}`,
      };
    } catch (error) {
      return {
        pass: false,
        message: () =>
          error instanceof Error
            ? error.message
            : `expected process ${processId} to emit watched line ${this.utils.printExpected(line)}`,
      };
    }
  },
});

export function collectEvents(manager: ProcessManager): ManagerEvent[] {
  const events: ManagerEvent[] = [];
  manager.onEvent((event) => events.push(event));
  return events;
}

export async function waitForEnd(
  manager: ProcessManager,
  id: string,
): Promise<ProcessInfo> {
  const current = manager.get(id);
  if (current && !LIVE_STATUSES.has(current.status)) return current;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for process ${id} to end`));
    }, 5000);

    const unsubscribe = manager.onEvent((event) => {
      if (event.type !== "process_ended" || event.info.id !== id) return;

      clearTimeout(timeout);
      unsubscribe();
      resolve(event.info);
    });
  });
}

export async function waitForEndedCount(
  manager: ProcessManager,
  ids: Set<string>,
): Promise<void> {
  const pending = new Set(ids);
  for (const id of ids) {
    const current = manager.get(id);
    if (current && !LIVE_STATUSES.has(current.status)) pending.delete(id);
  }

  if (pending.size === 0) return;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(
          `Timed out waiting for processes to end: ${Array.from(pending).join(", ")}`,
        ),
      );
    }, 5000);

    const unsubscribe = manager.onEvent((event) => {
      if (event.type !== "process_ended") return;

      pending.delete(event.info.id);
      if (pending.size > 0) return;

      clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

export async function waitForWatchMatch(
  manager: ProcessManager,
  events: ManagerEvent[],
  processId: string,
  predicate: (match: LogWatchMatchEvent) => boolean,
): Promise<LogWatchMatchEvent> {
  const existing = findWatchMatch(events, processId, predicate);
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for watch match on ${processId}`));
    }, 5000);

    const unsubscribe = manager.onEvent((event) => {
      if (event.type !== "process_watch_matched") return;
      if (event.match.processId !== processId) return;
      if (!predicate(event.match)) return;

      clearTimeout(timeout);
      unsubscribe();
      resolve(event.match);
    });
  });
}

function findWatchMatch(
  events: ManagerEvent[],
  processId: string,
  predicate: (match: LogWatchMatchEvent) => boolean,
): LogWatchMatchEvent | null {
  for (const event of events) {
    if (event.type !== "process_watch_matched") continue;
    if (event.match.processId !== processId) continue;
    if (predicate(event.match)) return event.match;
  }

  return null;
}
