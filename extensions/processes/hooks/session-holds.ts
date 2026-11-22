import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import type { ProcessInfo } from "../../../src/types";
import {
  CHANNELS,
  type ProcessesHoldEndedPayload,
  type ProcessesHoldStartedPayload,
} from "../../shared/protocol";

const HELD_STATUSES = new Set<ProcessInfo["status"]>([
  "running",
  "terminating",
]);

export interface SessionHolds {
  /** Emit hold_started for a live process. No-op if not live or already held. */
  hold(info: ProcessInfo): void;
  /** Release every hold and stop listening. Runs on session shutdown. */
  dispose(): void;
}

/**
 * Tracks processes started with `holdSession: true`. Each hold emits
 * processes:hold_started once and processes:hold_ended exactly once, on
 * whichever comes first: process end, terminate timeout, removal from the
 * registry, or dispose.
 */
export function createSessionHolds(
  events: EventBus,
  manager: ProcessManager,
): SessionHolds {
  const held = new Set<string>();

  const release = (id: string, success: boolean): void => {
    if (!held.delete(id)) return;
    const payload: ProcessesHoldEndedPayload = { id, success };
    events.emit(CHANNELS.HOLD_ENDED, payload);
  };

  const unsubscribe = manager.onEvent((event) => {
    if (event.type === "process_ended") {
      release(event.info.id, event.info.success === true);
      return;
    }
    if (event.type === "processes_changed") {
      // Covers terminate_timeout (no process_ended) and registry removal.
      for (const id of [...held]) {
        const info = manager.get(id);
        if (!info || !HELD_STATUSES.has(info.status)) {
          release(id, info?.success === true);
        }
      }
    }
  });

  return {
    hold(info) {
      if (held.has(info.id)) return;
      const current = manager.get(info.id);
      if (!current || !HELD_STATUSES.has(current.status)) return;
      held.add(info.id);
      const payload: ProcessesHoldStartedPayload = {
        id: info.id,
        name: info.name,
        command: info.command,
      };
      events.emit(CHANNELS.HOLD_STARTED, payload);
    },
    dispose() {
      unsubscribe();
      for (const id of [...held]) release(id, false);
    },
  };
}
