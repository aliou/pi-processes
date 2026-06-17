import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import {
  CHANNELS,
  type CommandClearPayload,
  type CommandKillPayload,
} from "../../../src/protocol";
import type { KillResult } from "../../../src/types";
import { isRecord } from "../../../src/utils/is-record";
import type { NotificationRegistry } from "../notifications/registry";
import { killIntentionally } from "./kill-process";

export function registerCommandHandlers(
  events: EventBus,
  manager: ProcessManager,
  notifications: NotificationRegistry,
): () => void {
  const disposers = [
    events.on(CHANNELS.COMMAND_KILL, (payload) => {
      const command = payload as CommandKillPayload;
      if (!isCommandKillPayload(command)) return;

      void killIntentionally(manager, notifications, command.id, {
        signal: command.signal,
        timeoutMs: command.timeoutMs,
      }).then(
        (result) => safeReply(command.reply, result),
        () => safeReply(command.reply, createKillErrorResult(command.id)),
      );
    }),
    events.on(CHANNELS.COMMAND_CLEAR, (payload) => {
      const command = payload as CommandClearPayload;
      if (!isCommandClearPayload(command)) return;

      safeReply(command.reply, manager.clearFinished());
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}

function isCommandKillPayload(
  payload: CommandKillPayload,
): payload is CommandKillPayload {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    isOptionalSignal(payload.signal) &&
    isOptionalNumber(payload.timeoutMs) &&
    isReply(payload)
  );
}

function isCommandClearPayload(
  payload: CommandClearPayload,
): payload is CommandClearPayload {
  return isRecord(payload) && isReply(payload);
}

function isReply(
  payload: unknown,
): payload is { reply: (...args: never[]) => void } {
  return isRecord(payload) && typeof payload.reply === "function";
}

function isOptionalSignal(
  signal: unknown,
): signal is NodeJS.Signals | undefined {
  return signal === undefined || typeof signal === "string";
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === "number" && Number.isFinite(value))
  );
}

function safeReply<T>(reply: (result: T) => void, result: T): void {
  try {
    reply(result);
  } catch {
    // Reply callbacks are owned by the requester. Never let a bad requester
    // break shared command listeners or create unhandled promise rejections.
    return;
  }
}

function createKillErrorResult(id: string): KillResult {
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
      errorMessage: "Failed to kill process",
    },
  };
}
