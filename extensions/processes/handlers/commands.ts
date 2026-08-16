import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import type { KillResult } from "../../../src/types";
import {
  CHANNELS,
  type CommandClearPayload,
  type CommandKillPayload,
} from "../../shared/protocol";
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

      safeReply(command.reply, manager.clearFinished());
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
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
