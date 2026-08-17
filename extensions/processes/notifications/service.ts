import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import type { ManagerEvent, ProcessInfo } from "../../../src/types";
import { CHANNELS } from "../../shared/protocol";
import { classifyProcessEnd } from "./classify";
import {
  type CompiledLogMatcher,
  compileLogMatchers,
  evaluateLogMatchers,
  type LogMatchResult,
} from "./log-matchers";
import type { NotifyConfig, WatchState } from "./registry";
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
  // Keep in sync with DEFAULT_NOTIFY_CONFIG in tools/notify.ts. Success
  // defaults to a turn because "context" is only seen by an agent that is
  // still streaming when the process ends.
  onSuccess: "turn",
  onFailure: "turn",
  // External kills surface as context by default (see DEFAULT_NOTIFY_CONFIG
  // in tools/notify.ts for rationale). Intentional stops are classified
  // separately and never reach this branch.
  onKilled: "context",
};

export interface NotificationServiceDeps {
  /**
   * Event bus used to fan out notification events on CHANNELS.NOTIFICATION.
   * The service never calls pi.sendMessage directly; a core delivery listener
   * converts the emitted payload into a persisted custom message. This keeps
   * notification flow event-driven and lets UI extensions observe the same
   * events (e.g. for log-match highlighting).
   */
  events: EventBus;
  manager: ProcessManager;
  registry: NotificationRegistry;
  getProcess: (id: string) => ProcessInfo | null;
}

interface ProcessMatcherState {
  matchers: CompiledLogMatcher[];
  revision: number;
  generation: number;
}

export function createNotificationService(deps: NotificationServiceDeps): {
  dispose: () => void;
} {
  const { events, manager, registry, getProcess } = deps;
  let disposed = false;
  const matcherStates = new Map<string, ProcessMatcherState>();

  const unsubscribe = manager.onEvent(handleEvent);

  function handleEvent(event: ManagerEvent): void {
    if (disposed) return;

    if (event.type === "process_ended") {
      // Defer to a microtask so that tool code (e.g. executeStart) can
      // register the notify config in the registry before we read it.
      // manager.start() may synchronously emit process_ended for missing_pid.
      queueMicrotask(() => {
        if (disposed) return;
        handleProcessEnded(event.info);
      });
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

    if (isIntentionalStop) {
      const details = buildLifecycleDetails(info, kind, "context");
      events.emit(CHANNELS.NOTIFICATION, details);

      cleanupMatcherState(info.id);
      registry.unregister(info.id);
      return;
    }

    const config = registry.get(info.id);
    const attention = resolveAttention(kind, config);

    const shouldForceDisplay = kind === "crash" || kind === "failure";

    if (attention === "ignore" && !shouldForceDisplay) {
      cleanupMatcherState(info.id);
      registry.unregister(info.id);
      return;
    }

    const effectiveAttention: Attention =
      attention === "ignore" && shouldForceDisplay ? "context" : attention;

    const details = buildLifecycleDetails(info, kind, effectiveAttention);
    events.emit(CHANNELS.NOTIFICATION, details);

    cleanupMatcherState(info.id);
    registry.unregister(info.id);
  }

  function handleOutputChanged(
    event: ManagerEvent & { type: "process_output_changed" },
  ): void {
    if (!event.appendedText || event.appendedText.length === 0) return;

    const watchState = registry.getWatchState(event.id);
    if (!watchState) return;

    const state = syncMatcherState(event.id, watchState);
    if (!state) return;

    const matchTime = performance.now();
    const matches = evaluateLogMatchers(
      state.matchers,
      event.appendedText,
      matchTime,
    );

    const processInfo = getProcess(event.id);
    const timestamp = Date.now();

    for (const match of matches) {
      const attention = match.on;
      const details = buildLogMatchDetails(
        event.id,
        processInfo,
        match,
        attention,
        timestamp,
      );
      events.emit(CHANNELS.NOTIFICATION, details);
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
      case "log_match":
        return "turn";
      case "log_match_suppressed":
        return "context";
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

  function syncMatcherState(
    processId: string,
    watchState: WatchState,
  ): ProcessMatcherState | null {
    const existing = matcherStates.get(processId);

    if (!existing) {
      const matchers = compileLogMatchers({
        logMatches: watchState.logMatches,
      });
      if (matchers.length === 0) return null;
      const state: ProcessMatcherState = {
        matchers,
        revision: watchState.revision,
        generation: watchState.generation,
      };
      matcherStates.set(processId, state);
      return state;
    }

    if (existing.revision === watchState.revision) return existing;

    const next = compileLogMatchers({ logMatches: watchState.logMatches });

    if (existing.generation === watchState.generation) {
      preserveMatcherRuntimeState(existing.matchers, next);
    }

    if (next.length === 0) {
      matcherStates.delete(processId);
      return null;
    }

    const state: ProcessMatcherState = {
      matchers: next,
      revision: watchState.revision,
      generation: watchState.generation,
    };
    matcherStates.set(processId, state);
    return state;
  }

  function preserveMatcherRuntimeState(
    prev: CompiledLogMatcher[],
    next: CompiledLogMatcher[],
  ): void {
    const byKey = new Map<string, CompiledLogMatcher[]>();
    for (const m of prev) {
      const key = matcherIdentityKey(m);
      const bucket = byKey.get(key);
      if (bucket) {
        bucket.push(m);
      } else {
        byKey.set(key, [m]);
      }
    }

    for (const m of next) {
      const key = matcherIdentityKey(m);
      const bucket = byKey.get(key);
      if (!bucket || bucket.length === 0) continue;
      const donor = bucket.shift();
      if (!donor) continue;
      m.fired = donor.fired;
      m.lastMatchTime = donor.lastMatchTime;
    }
  }

  function matcherIdentityKey(m: {
    pattern: string;
    mode: string;
    stream: string;
    repeat: boolean;
    on: string;
  }): string {
    return JSON.stringify([m.pattern, m.mode, m.stream, m.repeat, m.on]);
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
