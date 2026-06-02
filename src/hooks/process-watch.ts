import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ResolvedProcessesConfig } from "../config";
import { MESSAGE_TYPE_PROCESS_UPDATE } from "../constants";
import type { ProcessManager } from "../manager";
import { safeSendMessage } from "./utils";

interface ProcessWatchUpdateDetails {
  kind: "watch_matched";
  processId: string;
  processName: string;
  command: string;
  source: "stdout" | "stderr";
  line: string;
  watch: {
    index: number;
    pattern: string;
    stream: "stdout" | "stderr" | "both";
    repeat: boolean;
  };
}

const REPEAT_WATCH_TURN_COOLDOWN_MS = 5000;

export function setupProcessWatchHook(
  pi: ExtensionAPI,
  manager: ProcessManager,
  config: ResolvedProcessesConfig,
) {
  // Per-watch wake-policy state, keyed by `${processId}:${watchIndex}`.
  const lastRepeatTurnAt = new Map<string, number>();
  const wakeCounts = new Map<string, number>();
  const budgetNotified = new Set<string>();
  const lastEmittedLine = new Map<string, string>();

  const clearProcessState = (processId: string) => {
    const prefix = `${processId}:`;
    for (const key of lastRepeatTurnAt.keys()) {
      if (key.startsWith(prefix)) lastRepeatTurnAt.delete(key);
    }
    for (const key of wakeCounts.keys()) {
      if (key.startsWith(prefix)) wakeCounts.delete(key);
    }
    for (const key of budgetNotified) {
      if (key.startsWith(prefix)) budgetNotified.delete(key);
    }
    for (const key of lastEmittedLine.keys()) {
      if (key.startsWith(prefix)) lastEmittedLine.delete(key);
    }
  };

  manager.onEvent((event) => {
    if (event.type === "process_ended") {
      clearProcessState(event.info.id);
      return;
    }

    if (event.type !== "process_watch_matched") return;

    const match = event.match;
    const watchKey = `${match.processId}:${match.watch.index}`;

    // Dedupe: suppress a match whose line is identical to the previously
    // emitted one for this watch. Suppressed lines do not count against the
    // budget and do not update the cooldown.
    const dedupe = match.watch.dedupe ?? config.watch.dedupeConsecutive;
    if (dedupe && lastEmittedLine.get(watchKey) === match.line) {
      return;
    }

    // Wake budget: after `budget` emitted wakes, suppress further matches and
    // send exactly one budget-reached notice. 0 = unlimited.
    const budget = match.watch.maxWakes ?? config.watch.maxWakesPerWatch;
    const count = wakeCounts.get(watchKey) ?? 0;
    if (budget > 0 && count >= budget) {
      if (!budgetNotified.has(watchKey)) {
        budgetNotified.add(watchKey);
        safeSendMessage(
          pi,
          {
            customType: MESSAGE_TYPE_PROCESS_UPDATE,
            content:
              `Watch /${match.watch.pattern}/ on '${match.processName}' ` +
              `(${match.processId}) reached its wake budget (${budget}); ` +
              `further matches are suppressed. Inspect the full log via the ` +
              `process output/logs action.`,
            display: true,
          },
          { triggerTurn: false, deliverAs: "steer" },
        );
      }
      return;
    }

    const message =
      `Watch matched for '${match.processName}' (${match.processId}) ` +
      `[${match.source}] /${match.watch.pattern}/`;

    const details: ProcessWatchUpdateDetails = {
      kind: "watch_matched",
      processId: match.processId,
      processName: match.processName,
      command: match.processCommand,
      source: match.source,
      line: match.line,
      watch: {
        index: match.watch.index,
        pattern: match.watch.pattern,
        stream: match.watch.stream,
        repeat: match.watch.repeat,
      },
    };

    let triggerTurn = true;
    if (match.watch.repeat) {
      const now = Date.now();
      const last = lastRepeatTurnAt.get(watchKey) ?? 0;
      triggerTurn = now - last >= REPEAT_WATCH_TURN_COOLDOWN_MS;
      if (triggerTurn) {
        lastRepeatTurnAt.set(watchKey, now);
      }
    }

    wakeCounts.set(watchKey, count + 1);
    lastEmittedLine.set(watchKey, match.line);

    // Output-pattern wakes are steering events: deliver mid-turn (after the
    // current assistant turn's tool calls, before the next LLM call) so the
    // agent reacts to the match while it is still working. "steer" is Pi's
    // default delivery mode; making it explicit documents the intent and keeps
    // it stable if the default ever changes.
    safeSendMessage(
      pi,
      {
        customType: MESSAGE_TYPE_PROCESS_UPDATE,
        content: message,
        display: true,
        details,
      },
      { triggerTurn, deliverAs: "steer" },
    );
  });
}
