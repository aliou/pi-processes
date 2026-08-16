import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import { buildDroppedOutputLine } from "../../shared/line-buffer";
import {
  CHANNELS,
  type LogsSubscribePayload,
  type LogsUnsubscribePayload,
} from "../../shared/protocol";

interface LogSubscriber {
  subscriberId: string;
  processId: string;
}

export function registerLogSubscriptions(
  events: EventBus,
  manager: ProcessManager,
): () => void {
  const subscribers = new Map<string, LogSubscriber>();

  const disposeSubscribe = events.on(CHANNELS.LOGS_SUBSCRIBE, (payload) => {
    const request = payload as LogsSubscribePayload;

    const processInfo = manager.get(request.processId);

    if (!processInfo) {
      request.reply({ ok: false, error: "Process not found" });
      return;
    }

    const initialLines = manager.getCombinedOutput(
      request.processId,
      request.tailLines ?? 100,
    );

    if (!initialLines) {
      request.reply({ ok: false, error: "Process logs not found" });
      return;
    }

    subscribers.set(request.subscriberId, {
      subscriberId: request.subscriberId,
      processId: request.processId,
    });

    request.reply({ ok: true, initialLines });
  });

  const disposeUnsubscribe = events.on(CHANNELS.LOGS_UNSUBSCRIBE, (payload) => {
    const request = payload as LogsUnsubscribePayload;

    subscribers.delete(request.subscriberId);
  });

  const disposeManager = manager.onEvent((event) => {
    if (event.type === "process_ended") {
      removeSubscribersForProcess(subscribers, event.info.id);
      return;
    }

    if (event.type === "processes_changed") {
      removeStaleSubscribers(subscribers, manager);
      return;
    }

    if (event.type !== "process_output_changed") return;
    const lines = [
      ...(event.droppedLines
        ? [buildDroppedOutputLine(event.droppedLines)]
        : []),
      ...(event.appendedText ?? []),
    ];
    if (lines.length === 0) return;

    for (const subscriber of subscribers.values()) {
      if (subscriber.processId !== event.id) continue;

      events.emit(CHANNELS.LOGS_CHUNK, {
        subscriberId: subscriber.subscriberId,
        processId: subscriber.processId,
        lines,
      });
    }
  });

  return () => {
    disposeSubscribe();
    disposeUnsubscribe();
    disposeManager();
    subscribers.clear();
  };
}

function removeSubscribersForProcess(
  subscribers: Map<string, LogSubscriber>,
  processId: string,
): void {
  for (const [subscriberId, subscriber] of subscribers.entries()) {
    if (subscriber.processId === processId) subscribers.delete(subscriberId);
  }
}

function removeStaleSubscribers(
  subscribers: Map<string, LogSubscriber>,
  manager: ProcessManager,
): void {
  for (const [subscriberId, subscriber] of subscribers.entries()) {
    if (!manager.get(subscriber.processId)) subscribers.delete(subscriberId);
  }
}
