import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import type { ManagerEvent, ProcessInfo } from "../../../src/types";
import { sendProcessNotificationMessage } from "../notification-sender";
import { classifyProcessEnd } from "./classify";
import {
  type CompiledLogMatcher,
  compileLogMatchers,
  evaluateLogMatchers,
  type LogMatchResult,
} from "./log-matchers";
import type { NotifyConfig } from "./registry";
import {
  createNotificationRegistry,
  type NotificationRegistry,
} from "./registry";
import type {
  Attention,
  ProcessNotificationDetails,
  ProcessNotificationKind,
} from "./types";

const DEFAULT_ATTENTION: Record<
  "onSuccess" | "onFailure" | "onKilled",
  Attention
> = {
  onSuccess: "context",
  onFailure: "turn",
  onKilled: "ignore",
};

export interface NotificationServiceDeps {
  pi: ExtensionAPI;
  manager: ProcessManager;
  registry: NotificationRegistry;
  getProcess: (id: string) => ProcessInfo | null;
}

interface ProcessMatcherState {
  matchers: CompiledLogMatcher[];
}

export function createNotificationService(deps: NotificationServiceDeps): {
  dispose: () => void;
} {
  const { pi, manager, registry, getProcess } = deps;
  let disposed = false;
  const matcherStates = new Map<string, ProcessMatcherState>();

  const unsubscribe = manager.onEvent(handleEvent);

  function handleEvent(event: ManagerEvent): void {
    if (disposed) return;

    if (event.type === "process_ended") {
      handleProcessEnded(event.info);
      return;
    }

    if (event.type === "process_output_changed") {
      handleOutputChanged(event);
      return;
    }
  }

  function handleProcessEnded(info: ProcessInfo): void {
    const isIntentionalStop = registry.consumeIntentionalStop(info.id);
    const kind = classifyProcessEnd(info);

    if (isIntentionalStop && kind === "killed") {
      cleanupMatcherState(info.id);
      registry.unregister(info.id);
      return;
    }

    const config = registry.get(info.id);
    const attention = resolveAttention(kind, config);

    const shouldForceDisplay =
      kind === "crash" || kind === "failure" || kind === "timeout";

    if (attention === "ignore" && !shouldForceDisplay) {
      cleanupMatcherState(info.id);
      registry.unregister(info.id);
      return;
    }

    const effectiveAttention: Attention =
      attention === "ignore" && shouldForceDisplay ? "context" : attention;

    const details = buildLifecycleDetails(info, kind, effectiveAttention);
    const sendOptions = attentionToSendOptions(effectiveAttention);

    sendProcessNotificationMessage(pi, details, sendOptions);

    cleanupMatcherState(info.id);
    registry.unregister(info.id);
  }

  function handleOutputChanged(
    event: ManagerEvent & { type: "process_output_changed" },
  ): void {
    if (!event.appendedText || event.appendedText.length === 0) return;

    const config = registry.get(event.id);
    if (!config) return;

    let state = matcherStates.get(event.id);
    if (!state) {
      const matchers = compileLogMatchers(config);
      if (matchers.length === 0) return;
      state = { matchers };
      matcherStates.set(event.id, state);
    }

    const now = Date.now();
    const matches = evaluateLogMatchers(
      state.matchers,
      event.appendedText,
      now,
    );

    const processInfo = getProcess(event.id);

    for (const match of matches) {
      const attention = match.on;
      const details = buildLogMatchDetails(
        event.id,
        processInfo,
        match,
        attention,
        now,
      );
      const sendOptions = attentionToSendOptions(attention);
      sendProcessNotificationMessage(pi, details, sendOptions);
    }
  }

  function resolveAttention(
    kind: ProcessNotificationKind,
    config: NotifyConfig | null,
  ): Attention {
    switch (kind) {
      case "success":
        return config?.onSuccess ?? DEFAULT_ATTENTION.onSuccess;
      case "failure":
      case "crash":
        return config?.onFailure ?? DEFAULT_ATTENTION.onFailure;
      case "killed":
        return config?.onKilled ?? DEFAULT_ATTENTION.onKilled;
      case "timeout":
        return config?.onFailure ?? DEFAULT_ATTENTION.onFailure;
      case "log_match":
        return "turn";
    }
  }

  function buildLifecycleDetails(
    info: ProcessInfo,
    kind: ProcessNotificationKind,
    attention: Attention,
  ): ProcessNotificationDetails {
    const elapsed =
      info.endTime !== null && info.startTime > 0
        ? Math.round((info.endTime - info.startTime) / 1000)
        : null;

    let summary: string;
    if (kind === "success") {
      summary =
        elapsed !== null
          ? `Process "${info.name}" succeeded after ${elapsed}s.`
          : `Process "${info.name}" succeeded.`;
    } else if (kind === "killed" && info.signal) {
      const number =
        info.signal.number === null
          ? ""
          : ` (${info.signal.number}, ${info.signal.description})`;
      summary = `Process "${info.name}" ended after receiving ${info.signal.name}${number}.`;
    } else if (kind === "timeout") {
      summary = `Process "${info.name}" did not terminate within the kill timeout.`;
    } else if (info.exitCode !== null && info.exitCode !== 0) {
      summary =
        elapsed !== null
          ? `Process "${info.name}" failed with exit code ${info.exitCode} after ${elapsed}s.`
          : `Process "${info.name}" failed with exit code ${info.exitCode}.`;
    } else {
      summary = `Process "${info.name}" failed.`;
    }

    return {
      kind,
      processId: info.id,
      processName: info.name,
      command: info.command,
      timestamp: info.endTime ?? Date.now(),
      summary,
      status: info.status,
      exitCode: info.exitCode,
      endReason: info.endReason,
      signal: info.signal,
      attention,
    };
  }

  function buildLogMatchDetails(
    processId: string,
    processInfo: ProcessInfo | null,
    match: LogMatchResult,
    attention: Attention,
    timestamp: number,
  ): ProcessNotificationDetails {
    const name = processInfo?.name ?? processId;
    const command = processInfo?.command ?? "";
    const truncatedLine =
      match.line.length > 160 ? `${match.line.slice(0, 157)}...` : match.line;

    return {
      kind: "log_match",
      processId,
      processName: name,
      command,
      timestamp,
      summary: `Process "${name}" matched log pattern "${match.pattern}" on ${match.stream}.`,
      logMatch: {
        pattern: match.pattern,
        mode: match.mode,
        stream: match.stream,
        line: truncatedLine,
        matcherIndex: match.matcherIndex,
      },
      attention,
    };
  }

  function attentionToSendOptions(attention: Attention): {
    triggerTurn: boolean;
    deliverAs: "steer" | "followUp" | "nextTurn";
  } {
    switch (attention) {
      case "turn":
        return { triggerTurn: true, deliverAs: "steer" };
      case "context":
        return { triggerTurn: false, deliverAs: "nextTurn" };
      case "ignore":
        return { triggerTurn: false, deliverAs: "nextTurn" };
    }
  }

  function cleanupMatcherState(processId: string): void {
    matcherStates.delete(processId);
  }

  return {
    dispose() {
      disposed = true;
      unsubscribe();
      matcherStates.clear();
    },
  };
}

export { createNotificationRegistry };
