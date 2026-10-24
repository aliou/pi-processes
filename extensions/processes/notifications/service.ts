import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../src/manager";
import type { ManagerEvent, ProcessInfo, WatchMatch } from "../../../src/types";
import { resolveWakeAttention } from "../../../src/wake";
import { CHANNELS } from "../../shared/protocol";
import { classifyProcessEnd } from "./classify";
import type {
  Attention,
  ProcessNotificationDetails,
  ProcessNotificationKind,
} from "./types";

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
}

export function createNotificationService(deps: NotificationServiceDeps): {
  dispose: () => void;
} {
  const { events, manager } = deps;
  let disposed = false;

  const unsubscribe = manager.onEvent(handleEvent);

  function handleEvent(event: ManagerEvent): void {
    if (disposed) return;

    if (event.type === "process_ended") {
      // Defer to a microtask so that tool code (e.g. executeStart) can
      // register the wake config in the manager before we read it.
      // manager.start() may synchronously emit process_ended for missing_pid.
      queueMicrotask(() => {
        if (disposed) return;
        handleProcessEnded(event.info);
      });
      return;
    }

    if (event.type === "process_watch_matched") {
      handleWatchMatches(event.id, event.matches);
      return;
    }
  }

  function handleProcessEnded(info: ProcessInfo): void {
    const isIntentionalStop = manager.consumeIntentionalStop(info.id);
    const kind = classifyProcessEnd(info);

    if (isIntentionalStop) {
      const details = buildLifecycleDetails(info, kind, "context");
      events.emit(CHANNELS.NOTIFICATION, details);
      return;
    }

    const attention = resolveEndAttention(info.id, kind);

    const shouldForceDisplay = kind === "crash" || kind === "failure";

    if (attention === "ignore" && !shouldForceDisplay) {
      return;
    }

    const effectiveAttention: Attention =
      attention === "ignore" && shouldForceDisplay ? "context" : attention;

    const details = buildLifecycleDetails(info, kind, effectiveAttention);
    events.emit(CHANNELS.NOTIFICATION, details);
  }

  function resolveEndAttention(
    processId: string,
    kind: ProcessNotificationKind,
  ): Attention {
    const config = manager.getWakeConfig(processId);
    switch (kind) {
      case "success":
        return resolveWakeAttention("onSuccess", config);
      case "failure":
      case "crash":
        return resolveWakeAttention("onFailure", config);
      case "killed":
        return resolveWakeAttention("onKilled", config);
      case "log_match":
        return "turn";
      case "log_match_suppressed":
        return "context";
    }
  }

  function handleWatchMatches(processId: string, matches: WatchMatch[]): void {
    const processInfo = manager.get(processId);
    const timestamp = Date.now();

    for (const match of matches) {
      const details = buildLogMatchDetails(
        processId,
        processInfo,
        match,
        match.on,
        timestamp,
      );
      events.emit(CHANNELS.NOTIFICATION, details);
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
    match: WatchMatch,
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

  return {
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}
