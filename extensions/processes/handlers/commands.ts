import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import {
  CHANNELS,
  type CommandClearPayload,
  type CommandKillPayload,
} from "../../../src/protocol";
import type { KillResult } from "../../../src/types";
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
      }).then(command.reply, () => {
        command.reply(createKillErrorResult(command.id));
      });
    }),
    events.on(CHANNELS.COMMAND_CLEAR, (payload) => {
      const command = payload as CommandClearPayload;
      if (!isCommandClearPayload(command)) return;

      command.reply(manager.clearFinished());
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
    isRecord(payload) && typeof payload.id === "string" && isReply(payload)
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

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === "object" && payload !== null;
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
