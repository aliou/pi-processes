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
import type { ProcessProtocolConfig } from "../config";

export function registerRequestHandlers(
  events: EventBus,
  manager: ProcessManager,
  getConfig: () => ProcessProtocolConfig,
): () => void {
  const disposers = [
    events.on(CHANNELS.REQUEST_LIST, (payload) => {
      const request = payload as RequestListPayload;

      request.reply(manager.list());
    }),
    events.on(CHANNELS.REQUEST_GET, (payload) => {
      const request = payload as RequestGetPayload;

      request.reply(manager.get(request.id));
    }),
    events.on(CHANNELS.REQUEST_OUTPUT, (payload) => {
      const request = payload as RequestOutputPayload;

      request.reply(manager.getOutput(request.id, request.tailLines));
    }),
    events.on(CHANNELS.REQUEST_COMBINED_OUTPUT, (payload) => {
      const request = payload as RequestCombinedOutputPayload;

      request.reply(manager.getCombinedOutput(request.id, request.tailLines));
    }),
    events.on(CHANNELS.REQUEST_LOG_FILES, (payload) => {
      const request = payload as RequestLogFilesPayload;

      request.reply(manager.getLogFiles(request.id));
    }),
    events.on(CHANNELS.REQUEST_FILE_SIZE, (payload) => {
      const request = payload as RequestFileSizePayload;

      request.reply(manager.getFileSize(request.id));
    }),
    events.on(CHANNELS.REQUEST_CONFIG, (payload) => {
      const request = payload as RequestConfigPayload;

      request.reply(getConfig());
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}
