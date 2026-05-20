import type { ProcessManager } from "../../src/manager";
import {
  LIVE_STATUSES,
  type ManagerEvent,
  type ProcessInfo,
} from "../../src/types";

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
