import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { MESSAGE_TYPE_PROCESS_UPDATE } from "../constants";
import type { ProcessManager } from "../manager";

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
) {
  const lastRepeatTurnAt = new Map<string, number>();

  manager.onEvent((event) => {
    if (event.type === "process_ended") {
      // Cleanup cooldown state for this process.
      const prefix = `${event.info.id}:`;
      for (const key of lastRepeatTurnAt.keys()) {
        if (key.startsWith(prefix)) {
          lastRepeatTurnAt.delete(key);
        }
      }
      return;
    }

    if (event.type !== "process_watch_matched") return;

    const match = event.match;
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
      const watchKey = `${match.processId}:${match.watch.index}`;
      const now = Date.now();
      const last = lastRepeatTurnAt.get(watchKey) ?? 0;
      triggerTurn = now - last >= REPEAT_WATCH_TURN_COOLDOWN_MS;
      if (triggerTurn) {
        lastRepeatTurnAt.set(watchKey, now);
      }
    }

    pi.sendMessage(
      {
        customType: MESSAGE_TYPE_PROCESS_UPDATE,
        content: message,
        display: true,
        details,
      },
      { triggerTurn },
    );
  });
}
