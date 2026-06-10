import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import {
  CHANNELS,
  type LogsSubscribePayload,
  type LogsUnsubscribePayload,
} from "../../../src/protocol";

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
    if (!isLogsSubscribePayload(request)) return;

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
    if (!isLogsUnsubscribePayload(request)) return;

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
    if (!event.appendedText || event.appendedText.length === 0) return;

    for (const subscriber of subscribers.values()) {
      if (subscriber.processId !== event.id) continue;

      events.emit(CHANNELS.LOGS_CHUNK, {
        subscriberId: subscriber.subscriberId,
        processId: subscriber.processId,
        lines: event.appendedText,
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

function isLogsSubscribePayload(
  payload: LogsSubscribePayload,
): payload is LogsSubscribePayload {
  return (
    isRecord(payload) &&
    typeof payload.subscriberId === "string" &&
    typeof payload.processId === "string" &&
    isOptionalNumber(payload.tailLines) &&
    isReply(payload)
  );
}

function isLogsUnsubscribePayload(
  payload: LogsUnsubscribePayload,
): payload is LogsUnsubscribePayload {
  return isRecord(payload) && typeof payload.subscriberId === "string";
}

function isReply(
  payload: unknown,
): payload is { reply: (...args: never[]) => void } {
  return isRecord(payload) && typeof payload.reply === "function";
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null;
}
