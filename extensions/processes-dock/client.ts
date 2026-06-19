import type { EventBus } from "@earendil-works/pi-coding-agent";
import {
  CHANNELS,
  type ProcessProtocolConfig,
  type RequestCombinedOutputPayload,
  type RequestConfigPayload,
  type RequestGetPayload,
  type RequestListPayload,
} from "../../src/protocol";
import type { ProcessInfo } from "../../src/types";

export type ProcessLogLine = { type: "stdout" | "stderr"; text: string };

export function requestProcessList(events: EventBus): ProcessInfo[] {
  let processes: ProcessInfo[] = [];
  const payload: RequestListPayload = {
    reply: (result) => (processes = result),
  };
  events.emit(CHANNELS.REQUEST_LIST, payload);
  return processes;
}

export function requestProcess(
  events: EventBus,
  id: string,
): ProcessInfo | null {
  let process: ProcessInfo | null = null;
  const payload: RequestGetPayload = {
    id,
    reply: (result) => (process = result),
  };
  events.emit(CHANNELS.REQUEST_GET, payload);
  return process;
}

export function requestCombinedOutput(
  events: EventBus,
  id: string,
  tailLines?: number,
): ProcessLogLine[] {
  let lines: ProcessLogLine[] | null = null;
  const payload: RequestCombinedOutputPayload = {
    id,
    tailLines,
    reply: (result) => (lines = result),
  };
  events.emit(CHANNELS.REQUEST_COMBINED_OUTPUT, payload);
  return lines ?? [];
}

export function requestConfig(events: EventBus): ProcessProtocolConfig {
  let config: ProcessProtocolConfig | null = null;
  const payload: RequestConfigPayload = {
    reply: (result) => (config = result),
  };
  events.emit(CHANNELS.REQUEST_CONFIG, payload);
  if (!config)
    throw new Error("processes core extension did not reply to config request");
  return config;
}
