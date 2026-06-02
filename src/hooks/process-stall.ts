import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ResolvedProcessesConfig } from "../config";
import { MESSAGE_TYPE_PROCESS_UPDATE } from "../constants";
import type { ProcessManager } from "../manager";
import { safeSendMessage } from "./utils";

interface ProcessStallDetails {
  kind: "stalled";
  processId: string;
  processName: string;
  command: string;
  silenceSeconds: number;
}

interface StallState {
  timer: ReturnType<typeof setTimeout>;
  notified: boolean;
}

/**
 * Silence-based stall detector. Tracks per-process output cadence and sends
 * a steering wake when a running process produces no output for longer than
 * `config.stall.silenceSeconds`.
 *
 * Timer lifecycle:
 * - Scheduled on `process_started` (process gets silenceSeconds to produce
 *   its first output before being flagged).
 * - Reset on every `process_output_changed` (the 100ms output-event throttle
 *   in the manager is negligible against a 45s default threshold).
 * - Cleared on `process_ended` and `processes_changed` (clearFinished).
 * - Bulk-cleared on `session_shutdown` (manager.cleanup does not emit
 *   per-process events).
 *
 * After a stall alert, the flag is reset when new output arrives, so a
 * fresh silence period triggers a fresh alert (not spammed every tick).
 */
export function setupProcessStallHook(
  pi: ExtensionAPI,
  manager: ProcessManager,
  config: ResolvedProcessesConfig,
): void {
  if (!config.stall.enabled) return;

  const thresholdMs = config.stall.silenceSeconds * 1000;
  const states = new Map<string, StallState>();

  function fireStall(processId: string): void {
    const state = states.get(processId);
    if (!state || state.notified) return;
    state.notified = true;

    const info = manager.get(processId);
    if (!info) {
      clearCheck(processId);
      return;
    }

    const silenceSeconds = config.stall.silenceSeconds;

    const details: ProcessStallDetails = {
      kind: "stalled",
      processId,
      processName: info.name,
      command: info.command,
      silenceSeconds,
    };

    // Stall wakes are steering events: deliver mid-turn so the agent can
    // react immediately (inspect output, write to stdin, or kill).
    safeSendMessage(
      pi,
      {
        customType: MESSAGE_TYPE_PROCESS_UPDATE,
        content:
          `Process '${info.name}' (${processId}) has produced no output ` +
          `for ${silenceSeconds}s — it may be waiting for input or stalled. ` +
          `Inspect with output, respond with write, or kill it.`,
        display: true,
        details,
      },
      { triggerTurn: true, deliverAs: "steer" },
    );
  }

  function scheduleCheck(processId: string): void {
    clearCheck(processId);
    const timer = setTimeout(() => fireStall(processId), thresholdMs);
    states.set(processId, { timer, notified: false });
  }

  function clearCheck(processId: string): void {
    const state = states.get(processId);
    if (state) {
      clearTimeout(state.timer);
      states.delete(processId);
    }
  }

  function clearAll(): void {
    for (const state of states.values()) {
      clearTimeout(state.timer);
    }
    states.clear();
  }

  manager.onEvent((event) => {
    switch (event.type) {
      case "process_started": {
        scheduleCheck(event.info.id);
        break;
      }
      case "process_output_changed": {
        // Reset the silence timer. If the process was previously flagged
        // as stalled, scheduleCheck clears the old state (including the
        // notified flag) so a future silence period triggers a fresh alert.
        if (states.has(event.id)) {
          scheduleCheck(event.id);
        }
        break;
      }
      case "process_ended": {
        clearCheck(event.info.id);
        break;
      }
      case "processes_changed": {
        // clearFinished() was called — prune tracked IDs whose processes
        // no longer exist.
        for (const id of states.keys()) {
          if (!manager.get(id)) {
            clearCheck(id);
          }
        }
        break;
      }
    }
  });

  // manager.cleanup() kills everything without emitting per-process events.
  pi.on("session_shutdown", () => {
    clearAll();
  });
}
