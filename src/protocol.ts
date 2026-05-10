import type { KillResult, LogWatchMatchEvent, ProcessInfo } from "./types";

export const CHANNELS = {
  // Core broadcasts
  STARTED: "processes:started",
  ENDED: "processes:ended",
  OUTPUT_CHANGED: "processes:output_changed",
  WATCH_MATCHED: "processes:watch_matched",
  CHANGED: "processes:changed",

  // Request channels (UI -> core, sync callback)
  REQUEST_LIST: "processes:request:list",
  REQUEST_GET: "processes:request:get",
  REQUEST_OUTPUT: "processes:request:output",
  REQUEST_COMBINED_OUTPUT: "processes:request:combined_output",
  REQUEST_LOG_FILES: "processes:request:log_files",
  REQUEST_FILE_SIZE: "processes:request:file_size",
  REQUEST_CONFIG: "processes:request:config",

  // Command channels (UI -> core, callback)
  COMMAND_KILL: "processes:command:kill",
  COMMAND_CLEAR: "processes:command:clear",

  // Log subscription channels
  LOGS_SUBSCRIBE: "processes:logs:subscribe",
  LOGS_UNSUBSCRIBE: "processes:logs:unsubscribe",
  LOGS_CHUNK: "processes:logs:chunk",
} as const;

// --- Broadcast payloads (core emits, UI listens) ---

export type ProcessesStartedPayload = ProcessInfo;
export type ProcessesEndedPayload = ProcessInfo;
export type ProcessesOutputChangedPayload = {
  id: string;
  appendedText?: Array<{ type: "stdout" | "stderr"; text: string }>;
};
export type ProcessesWatchMatchedPayload = LogWatchMatchEvent;
export type ProcessesChangedPayload = {
  reason: "started" | "ended" | "cleared";
};

// --- Request payloads (UI emits, core listens and calls reply synchronously) ---

export interface RequestListPayload {
  reply: (processes: ProcessInfo[]) => void;
}

export interface RequestGetPayload {
  id: string;
  reply: (info: ProcessInfo | null) => void;
}

export interface RequestOutputPayload {
  id: string;
  tailLines?: number;
  reply: (
    output: { stdout: string[]; stderr: string[]; status: string } | null,
  ) => void;
}

export interface RequestCombinedOutputPayload {
  id: string;
  tailLines?: number;
  reply: (
    lines: Array<{ type: "stdout" | "stderr"; text: string }> | null,
  ) => void;
}

export interface RequestLogFilesPayload {
  id: string;
  reply: (
    files: {
      stdoutFile: string;
      stderrFile: string;
      combinedFile: string;
    } | null,
  ) => void;
}

export interface RequestFileSizePayload {
  id: string;
  reply: (sizes: { stdout: number; stderr: number } | null) => void;
}

export interface RequestConfigPayload {
  reply: (config: unknown) => void;
}

// --- Command payloads (UI emits, core handles then calls reply) ---

export interface CommandKillPayload {
  id: string;
  signal?: NodeJS.Signals;
  timeoutMs?: number;
  reply: (result: KillResult) => void;
}

export interface CommandClearPayload {
  reply: (cleared: number) => void;
}

// --- Log subscription payloads ---

export interface LogsSubscribePayload {
  subscriberId: string;
  processId: string;
  reply: (
    result:
      | {
          ok: true;
          initialLines: Array<{ type: "stdout" | "stderr"; text: string }>;
        }
      | { ok: false; error: string },
  ) => void;
}

export interface LogsUnsubscribePayload {
  subscriberId: string;
}

export interface LogsChunkPayload {
  subscriberId: string;
  processId: string;
  lines: Array<{ type: "stdout" | "stderr"; text: string }>;
}

// --- Helper functions ---

/**
 * Emit a request on an event bus. Thin wrapper for type safety at call sites.
 * The reply callback is included in the payload; the core handler calls it synchronously.
 */
export function emitRequest(
  events: { emit: (channel: string, payload: unknown) => void },
  channel: string,
  payload: unknown,
): void {
  events.emit(channel, payload);
}
