import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import {
  CHANNELS,
  type RequestCombinedOutputPayload,
  type RequestConfigPayload,
  type RequestFileSizePayload,
  type RequestGetPayload,
  type RequestListPayload,
  type RequestLogFilesPayload,
  type RequestOutputPayload,
} from "../../../src/protocol";

export function registerRequestHandlers(
  events: EventBus,
  manager: ProcessManager,
): () => void {
  const disposers = [
    events.on(CHANNELS.REQUEST_LIST, (payload) => {
      const request = payload as RequestListPayload;
      if (!isRequestListPayload(request)) return;

      request.reply(manager.list());
    }),
    events.on(CHANNELS.REQUEST_GET, (payload) => {
      const request = payload as RequestGetPayload;
      if (!isIdRequest(request)) return;

      request.reply(manager.get(request.id));
    }),
    events.on(CHANNELS.REQUEST_OUTPUT, (payload) => {
      const request = payload as RequestOutputPayload;
      if (!isIdRequest(request)) return;

      request.reply(manager.getOutput(request.id, request.tailLines));
    }),
    events.on(CHANNELS.REQUEST_COMBINED_OUTPUT, (payload) => {
      const request = payload as RequestCombinedOutputPayload;
      if (!isIdRequest(request)) return;

      request.reply(manager.getCombinedOutput(request.id, request.tailLines));
    }),
    events.on(CHANNELS.REQUEST_LOG_FILES, (payload) => {
      const request = payload as RequestLogFilesPayload;
      if (!isIdRequest(request)) return;

      request.reply(manager.getLogFiles(request.id));
    }),
    events.on(CHANNELS.REQUEST_FILE_SIZE, (payload) => {
      const request = payload as RequestFileSizePayload;
      if (!isIdRequest(request)) return;

      request.reply(manager.getFileSize(request.id));
    }),
    events.on(CHANNELS.REQUEST_CONFIG, (payload) => {
      const request = payload as RequestConfigPayload;
      if (!isRequestConfigPayload(request)) return;

      // TODO(Phase 2F): return loaded process settings.
      request.reply({});
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}

function isRequestListPayload(
  payload: RequestListPayload,
): payload is RequestListPayload {
  return isRecord(payload) && isReply(payload);
}

function isRequestConfigPayload(
  payload: RequestConfigPayload,
): payload is RequestConfigPayload {
  return isRecord(payload) && isReply(payload);
}

function isIdRequest(
  payload:
    | RequestGetPayload
    | RequestOutputPayload
    | RequestCombinedOutputPayload
    | RequestLogFilesPayload
    | RequestFileSizePayload,
): payload is
  | RequestGetPayload
  | RequestOutputPayload
  | RequestCombinedOutputPayload
  | RequestLogFilesPayload
  | RequestFileSizePayload {
  return (
    isRecord(payload) && typeof payload.id === "string" && isReply(payload)
  );
}

function isReply(
  payload: unknown,
): payload is { reply: (...args: never[]) => void } {
  return isRecord(payload) && typeof payload.reply === "function";
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null;
}
