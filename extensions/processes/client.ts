/**
 * Core-extension request/command helpers for the `/ps` overview panel.
 *
 * The overview panel prefers the existing `pi.events` protocol channels over
 * calling the manager directly so a future split-out of the panel stays cheap.
 * These helpers are the core equivalent of `extensions/processes-logs/client.ts`
 * and `extensions/processes-dock/client.ts`.
 */

import type { EventBus } from "@earendil-works/pi-coding-agent";
import {
  CHANNELS,
  type CommandClearPayload,
  type CommandKillPayload,
  type CommandPinPayload,
  type CommandPinResult,
  type ProcessProtocolConfig,
  type RequestCombinedOutputPayload,
  type RequestConfigPayload,
  type RequestGetPayload,
  type RequestListPayload,
} from "../../src/protocol";
import type { KillResult, ProcessInfo } from "../../src/types";

export type ProcessLogLine = { type: "stdout" | "stderr"; text: string };

export function requestProcessList(events: EventBus): ProcessInfo[] {
  let processes: ProcessInfo[] = [];
  const payload: RequestListPayload = {
    reply: (result) => {
      processes = result;
    },
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
    reply: (result) => {
      process = result;
    },
  };
  events.emit(CHANNELS.REQUEST_GET, payload);
  return process;
}

export function requestConfig(events: EventBus): ProcessProtocolConfig {
  let config: ProcessProtocolConfig | null = null;
  const payload: RequestConfigPayload = {
    reply: (result) => {
      config = result;
    },
  };
  events.emit(CHANNELS.REQUEST_CONFIG, payload);
  if (!config) {
    throw new Error("processes core extension did not reply to config request");
  }
  return config;
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
    reply: (result) => {
      lines = result;
    },
  };
  events.emit(CHANNELS.REQUEST_COMBINED_OUTPUT, payload);
  return lines ?? [];
}

/**
 * Kill a managed process. Resolves when the kill handler replies, or with a
 * timeout error result if no listener responds.
 *
 * The kill handler runs `killIntentionally` asynchronously, so its reply fires
 * on a later microtask rather than during the emit. That is why this returns a
 * Promise (unlike the synchronous `requestClear`/`requestProcessList`): a
 * synchronous read of `result` would always miss the reply and report failure.
 *
 * The safety timeout defaults to the kill timeout plus headroom so a successful
 * slow kill still resolves first. The timer is unref'd so it never keeps the
 * event loop alive.
 */
export function requestKill(
  events: EventBus,
  id: string,
  options?: { signal?: NodeJS.Signals; timeoutMs?: number },
): Promise<KillResult> {
  return new Promise((resolve) => {
    let settled = false;
    const killTimeoutMs = options?.timeoutMs ?? 3000;
    const payload: CommandKillPayload = {
      id,
      signal: options?.signal,
      timeoutMs: killTimeoutMs,
      reply: (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(killTimeoutResult(id));
    }, killTimeoutMs + 2000);
    // Unref so a parked timer never keeps the event loop alive.
    timer.unref?.();
    events.emit(CHANNELS.COMMAND_KILL, payload);
  });
}

function killTimeoutResult(id: string): KillResult {
  return {
    ok: false,
    reason: "error",
    info: {
      id,
      name: "(unknown)",
      pid: -1,
      command: "",
      cwd: "",
      startTime: 0,
      endTime: null,
      status: "exited",
      exitCode: null,
      success: false,
      stdoutFile: "",
      stderrFile: "",
      endReason: null,
      signal: null,
      errorMessage: "No kill handler replied",
    },
  };
}

export function requestClear(events: EventBus): number {
  let cleared = 0;
  const payload: CommandClearPayload = {
    reply: (value) => {
      cleared = value;
    },
  };
  events.emit(CHANNELS.COMMAND_CLEAR, payload);
  return cleared;
}

/**
 * Pin a process to the dock. Resolves when the dock extension replies, or
 * rejects if no dock handler responds within `timeoutMs`.
 *
 * The dock extension must be loaded for this to succeed. If it is not
 * registered, no listener will reply and the promise rejects with a timeout.
 */
export function requestPin(
  events: EventBus,
  id: string | null,
  timeoutMs = 200,
): Promise<CommandPinResult> {
  return new Promise((resolve) => {
    let settled = false;
    const payload: CommandPinPayload = {
      id,
      reply: (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "Dock extension is not available" });
    }, timeoutMs);
    // The timeout needs to be unref'd so it never keeps the event loop alive.
    timer.unref?.();
    events.emit(CHANNELS.COMMAND_PIN, payload);
  });
}
