import type { EventBus } from "@earendil-works/pi-coding-agent";
import {
  CHANNELS,
  type LogsChunkPayload,
  type LogsSubscribePayload,
  type LogsUnsubscribePayload,
} from "../shared/protocol";
export type ProcessLogLine = { type: "stdout" | "stderr"; text: string };

export interface LogsConnection {
  initialLines: ProcessLogLine[];
  onChunk: (callback: (lines: ProcessLogLine[]) => void) => () => void;
  unsubscribe: () => void;
}

export function connectToProcessLogs(
  events: EventBus,
  processId: string,
  opts: { tailLines?: number } = {},
): LogsConnection | { ok: false; error: string } {
  const subscriberId = `processes-logs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let initialLines: ProcessLogLine[] = [];
  let error: string | null = null;
  let replied = false;
  let disposed = false;
  const chunkCallbacks = new Set<(lines: ProcessLogLine[]) => void>();

  const disposeChunkListener = events.on(CHANNELS.LOGS_CHUNK, (raw) => {
    if (disposed) return;
    const chunk = raw as LogsChunkPayload;
    if (chunk.subscriberId !== subscriberId || chunk.processId !== processId)
      return;

    for (const callback of chunkCallbacks) callback(chunk.lines);
  });

  const payload: LogsSubscribePayload = {
    subscriberId,
    processId,
    tailLines: opts.tailLines,
    reply: (result) => {
      replied = true;
      if (result.ok) {
        initialLines = result.initialLines;
      } else {
        error = result.error;
      }
    },
  };

  events.emit(CHANNELS.LOGS_SUBSCRIBE, payload);

  if (!replied) {
    disposeChunkListener();
    return {
      ok: false,
      error: "processes core extension did not reply to log subscription",
    };
  }
  if (error) {
    disposeChunkListener();
    return { ok: false, error };
  }

  return {
    initialLines,
    onChunk: (callback) => {
      chunkCallbacks.add(callback);
      return () => chunkCallbacks.delete(callback);
    },
    unsubscribe: () => {
      if (disposed) return;
      disposed = true;
      chunkCallbacks.clear();
      disposeChunkListener();
      const unsubscribePayload: LogsUnsubscribePayload = { subscriberId };
      events.emit(CHANNELS.LOGS_UNSUBSCRIBE, unsubscribePayload);
    },
  };
}
