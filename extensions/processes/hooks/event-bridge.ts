import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import { CHANNELS } from "../../../src/protocol";

export function registerEventBridge(
  events: EventBus,
  manager: ProcessManager,
): () => void {
  return manager.onEvent((event) => {
    switch (event.type) {
      case "process_started":
        events.emit(CHANNELS.STARTED, event.info);
        events.emit(CHANNELS.CHANGED, { reason: "started" });
        break;
      case "process_ended":
        events.emit(CHANNELS.ENDED, event.info);
        events.emit(CHANNELS.CHANGED, { reason: "ended" });
        break;
      case "process_output_changed":
        events.emit(CHANNELS.OUTPUT_CHANGED, {
          id: event.id,
          appendedText: event.appendedText,
          droppedLines: event.droppedLines,
        });
        break;
      case "processes_changed":
        events.emit(CHANNELS.CHANGED, { reason: "cleared" });
        break;
    }
  });
}
