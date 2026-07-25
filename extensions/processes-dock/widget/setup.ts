import type {
  EventBus,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  CHANNELS,
  type CommandPinPayload,
  type ProcessProtocolNotificationPayload,
} from "../../../src/protocol";
import { LIVE_STATUSES, type ProcessInfo } from "../../../src/types";
import { isRecord } from "../../../src/utils/is-record";
import { buildDroppedOutputLine, trimToBudget } from "../../shared/line-buffer";
import { isOutputChangedPayload } from "../../shared/output-payload";
import {
  type ProcessLogLine,
  requestCombinedOutput,
  requestConfig,
  requestProcess,
  requestProcessList,
} from "../client";
import { renderLogDock } from "../components/log-dock-component";
import { createDockState } from "../dock-state";
import { connectToProcessLogs, type LogsConnection } from "../logs-client";
import { renderStatusWidget } from "./status";
import type { DockActions, DockState } from "./types";

const DOCK_WIDGET_KEY = "processes-dock";
const STATUS_WIDGET_KEY = "processes-status";
const MAX_NOTIFY_MARKERS_PER_PROCESS = 100;
const MAX_PREVIEW_PROCESSES = 8;
const REFRESH_THROTTLE_MS = 125;

interface NotifyMatchMark {
  line: string;
  timestamp: number;
}

export interface DockController {
  actions: DockActions;
  refresh: () => void;
  dispose: () => void;
}

export function setupDockWidgets(
  ctx: ExtensionContext,
  events: EventBus,
): DockController | null {
  if (!ctx.hasUI) return null;

  const config = requestConfig(events);
  const state = createDockState({
    visibility: config.widget.dockDefaultState,
    followEnabled: config.follow.enabledByDefault,
  });

  const notifyMarkers = new Map<string, NotifyMatchMark[]>();
  const previews = new Map<string, ProcessLogLine | null>();
  const disposers: Array<() => void> = [];

  let disposed = false;
  let processes: ProcessInfo[] = [];
  let pinnedLines: ProcessLogLine[] = [];
  let processLogStream: Array<{ processId: string; line: ProcessLogLine }> = [];
  let pinnedConnection: LogsConnection | null = null;
  let pinnedConnectionId: string | null = null;
  let hasSeenRunningProcess = false;
  let pendingRefresh: NodeJS.Timeout | null = null;

  const render = () => {
    if (disposed) return;
    // Re-read config live: /ps:settings can change dock height and the
    // startup snapshot may predate the persisted merge.
    const liveConfig = requestConfig(events);
    const current = state.getState();
    const pinned = selectPinnedProcess(processes, current);
    const pinnedId = pinned?.id ?? null;

    if (current.visibility === "closed") {
      ctx.ui.setWidget(DOCK_WIDGET_KEY, undefined, {
        placement: "aboveEditor",
      });
      return;
    }

    const markerLines = new Set(
      (pinnedId ? notifyMarkers.get(pinnedId) : undefined)?.map(
        (mark) => mark.line,
      ) ?? [],
    );
    const notifyCounts = new Map(
      [...notifyMarkers.entries()].map(([processId, marks]) => [
        processId,
        marks.length,
      ]),
    );

    ctx.ui.setWidget(
      DOCK_WIDGET_KEY,
      (_tui, theme: Theme) => ({
        render: (width: number) =>
          renderLogDock(
            {
              processes,
              pinnedProcess: pinned,
              pinnedLines,
              processLogStream,
              previews,
              notifyLines: markerLines,
              notifyCounts,
              state: current,
            },
            theme,
            width,
            liveConfig.widget.dockHeight,
          ),
        invalidate: () => undefined,
      }),
      { placement: "aboveEditor" },
    );
  };

  const renderStatus = () => {
    if (disposed) return;
    // Re-read config live so toggling showStatusWidget in /ps:settings takes
    // effect without a restart.
    const liveConfig = requestConfig(events);
    if (!liveConfig.widget.showStatusWidget) {
      ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined, {
        placement: "belowEditor",
      });
      return;
    }
    if (processes.length === 0) {
      ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined, {
        placement: "belowEditor",
      });
      return;
    }
    // The width is only known at render time, so hand Pi a factory that
    // renders against the actual belowEditor column count instead of baking a
    // static width from process.stdout.columns (which drifts on resize / splits).
    ctx.ui.setWidget(
      STATUS_WIDGET_KEY,
      (_tui, theme: Theme) => ({
        render: (width: number) => renderStatusWidget(processes, theme, width),
        invalidate: () => undefined,
      }),
      { placement: "belowEditor" },
    );
  };

  const hardRefresh = () => {
    if (disposed) return;
    processes = sortProcesses(requestProcessList(events));
    const liveIds = new Set(processes.map((process) => process.id));
    for (const id of previews.keys()) {
      if (!liveIds.has(id)) previews.delete(id);
    }
    for (const id of notifyMarkers.keys()) {
      if (!liveIds.has(id)) notifyMarkers.delete(id);
    }
    if (processes.some((process) => process.status === "running")) {
      hasSeenRunningProcess = true;
    }

    const current = state.getState();
    if (current.focusedProcessId) {
      const pinned = selectPinnedProcess(processes, current);
      if (!pinned) {
        state.actions.setFocus(null);
      }
    }

    for (const process of processes.slice(0, MAX_PREVIEW_PROCESSES)) {
      const lines = requestCombinedOutput(events, process.id, 1);
      previews.set(process.id, lines.at(-1) ?? null);
    }

    seedProcessLogStream();
    syncPinnedConnection();

    if (
      processes.length === 0 ||
      (!state.getState().focusedProcessId &&
        hasSeenRunningProcess &&
        processes.every((process) => !LIVE_STATUSES.has(process.status)))
    ) {
      state.actions.close();
    }

    render();
    renderStatus();
  };

  const scheduleRefresh = () => {
    if (disposed || pendingRefresh) return;
    pendingRefresh = setTimeout(() => {
      pendingRefresh = null;
      hardRefresh();
    }, REFRESH_THROTTLE_MS);
  };

  const seedProcessLogStream = () => {
    const current = state.getState();
    if (current.visibility !== "expanded" || current.focusedProcessId) {
      processLogStream = [];
      return;
    }
    if (processLogStream.length > 0) return;

    processLogStream = trimToBudget(
      processes
        .filter((process) => LIVE_STATUSES.has(process.status))
        .flatMap((process) =>
          requestCombinedOutput(events, process.id, 4).map((line) => ({
            processId: process.id,
            line,
          })),
        ),
      config.output.maxOutputLines,
      config.output.maxOutputBytes,
      (entry) => entry.line.text,
    );
  };

  const syncPinnedConnection = () => {
    const current = state.getState();
    const pinned = selectPinnedProcess(processes, current);
    const shouldStream = current.visibility === "expanded" && pinned;

    if (!shouldStream) {
      pinnedConnection?.unsubscribe();
      pinnedConnection = null;
      pinnedConnectionId = null;
      pinnedLines = trimToBudget(
        pinned
          ? requestCombinedOutput(
              events,
              pinned.id,
              config.output.defaultTailLines,
            )
          : [],
        config.output.maxOutputLines,
        config.output.maxOutputBytes,
      );
      return;
    }

    if (pinnedConnection && pinnedConnectionId === pinned.id) return;

    pinnedConnection?.unsubscribe();
    pinnedConnection = null;
    pinnedConnectionId = null;

    const connection = connectToProcessLogs(events, pinned.id, {
      tailLines: config.output.defaultTailLines,
    });
    if (isLogsConnectionError(connection)) {
      pinnedLines = trimToBudget(
        requestCombinedOutput(
          events,
          pinned.id,
          config.output.defaultTailLines,
        ),
        config.output.maxOutputLines,
        config.output.maxOutputBytes,
      );
      return;
    }

    pinnedConnection = connection;
    pinnedConnectionId = pinned.id;
    pinnedLines = trimToBudget(
      connection.initialLines,
      config.output.maxOutputLines,
      config.output.maxOutputBytes,
    );

    connection.onChunk((lines: ProcessLogLine[]) => {
      if (disposed) return;
      const id = pinnedConnectionId;
      if (!id) return;
      pinnedLines.push(...lines);
      pinnedLines = trimToBudget(
        pinnedLines,
        config.output.maxOutputLines,
        config.output.maxOutputBytes,
      );
      const last = lines.at(-1);
      if (last) previews.set(id, last);
      render();
    });
  };

  const actions: DockActions = {
    getFocusedProcessId: state.actions.getFocusedProcessId,
    isFollowEnabled: state.actions.isFollowEnabled,
    setFocus: (processId) => {
      state.actions.setFocus(processId);
      seedProcessLogStream();
      syncPinnedConnection();
      render();
    },
    expand: () => {
      state.actions.expand();
      seedProcessLogStream();
      syncPinnedConnection();
      render();
    },
    collapse: () => {
      state.actions.collapse();
      seedProcessLogStream();
      syncPinnedConnection();
      render();
    },
    close: () => {
      state.actions.close();
      seedProcessLogStream();
      syncPinnedConnection();
      render();
    },
  };

  const handleStarted = () => {
    if (config.widget.dockDefaultState === "expanded") state.actions.expand();
    else if (config.widget.dockDefaultState === "collapsed") {
      state.actions.collapse();
    }
    scheduleRefresh();
  };

  const handleOutputChanged = (payload: unknown) => {
    if (!isOutputChangedPayload(payload)) {
      scheduleRefresh();
      return;
    }
    if (
      (!payload.appendedText || payload.appendedText.length === 0) &&
      !payload.droppedLines
    ) {
      scheduleRefresh();
      return;
    }

    const appended = [
      ...(payload.droppedLines
        ? [buildDroppedOutputLine(payload.droppedLines)]
        : []),
      ...(payload.appendedText ?? []),
    ];
    for (const line of appended) {
      previews.set(payload.id, line);
      processLogStream.push({ processId: payload.id, line });
    }
    processLogStream = trimToBudget(
      processLogStream,
      config.output.maxOutputLines,
      config.output.maxOutputBytes,
      (entry) => entry.line.text,
    );
    render();
  };

  const handlePin = (payload: unknown) => {
    const command = payload as CommandPinPayload;
    if (!isCommandPinPayload(command)) return;
    // COMMAND_PIN can arrive before the dock's throttled CHANGED refresh has
    // run. Refresh the local snapshot first so expand/pin renders immediately
    // against the current process list.
    processes = sortProcesses(requestProcessList(events));
    // id: null unpins the dock (mirrors `/ps:pin clear`).
    if (command.id === null) {
      actions.setFocus(null);
      actions.expand();
      render();
      safeReply(command.reply, { ok: true });
      return;
    }
    const process = requestProcess(events, command.id);
    if (!process) {
      safeReply(command.reply, { ok: false, error: "Process not found" });
      return;
    }
    if (
      !LIVE_STATUSES.has(process.status) &&
      actions.getFocusedProcessId() !== process.id
    ) {
      safeReply(command.reply, {
        ok: false,
        error: "Only running processes can be pinned",
      });
      return;
    }
    actions.setFocus(process.id);
    actions.expand();
    render();
    safeReply(command.reply, { ok: true });
  };

  disposers.push(events.on(CHANNELS.STARTED, handleStarted));
  disposers.push(events.on(CHANNELS.ENDED, scheduleRefresh));
  disposers.push(events.on(CHANNELS.CHANGED, scheduleRefresh));
  disposers.push(events.on(CHANNELS.OUTPUT_CHANGED, handleOutputChanged));
  disposers.push(
    events.on(CHANNELS.COMMAND_PIN, (payload) => {
      handlePin(payload);
    }),
  );
  disposers.push(
    events.on(CHANNELS.NOTIFICATION, (payload) => {
      if (!isLogMatchNotification(payload)) return;
      const list = notifyMarkers.get(payload.processId) ?? [];
      list.push({ line: payload.logMatch.line, timestamp: payload.timestamp });
      if (list.length > MAX_NOTIFY_MARKERS_PER_PROCESS) {
        list.splice(0, list.length - MAX_NOTIFY_MARKERS_PER_PROCESS);
      }
      notifyMarkers.set(payload.processId, list);
      render();
    }),
  );

  hardRefresh();

  return {
    actions,
    refresh: hardRefresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (pendingRefresh) clearTimeout(pendingRefresh);
      pinnedConnection?.unsubscribe();
      for (const dispose of disposers.splice(0)) dispose();
      ctx.ui.setWidget(DOCK_WIDGET_KEY, undefined, {
        placement: "aboveEditor",
      });
      ctx.ui.setWidget(STATUS_WIDGET_KEY, undefined, {
        placement: "belowEditor",
      });
    },
  };
}

function selectPinnedProcess(
  processes: ProcessInfo[],
  state: DockState,
): ProcessInfo | null {
  return state.focusedProcessId
    ? (processes.find((process) => process.id === state.focusedProcessId) ??
        null)
    : null;
}

function sortProcesses(processes: ProcessInfo[]): ProcessInfo[] {
  return [...processes].sort((a, b) => {
    const aLive = LIVE_STATUSES.has(a.status) ? 1 : 0;
    const bLive = LIVE_STATUSES.has(b.status) ? 1 : 0;
    if (bLive !== aLive) return bLive - aLive;
    return b.startTime - a.startTime;
  });
}

function isLogsConnectionError(
  connection: LogsConnection | { ok: false; error: string },
): connection is { ok: false; error: string } {
  return "ok" in connection && connection.ok === false;
}

function isLogMatchNotification(
  payload: unknown,
): payload is ProcessProtocolNotificationPayload & {
  kind: "log_match";
  logMatch: NonNullable<ProcessProtocolNotificationPayload["logMatch"]>;
} {
  return (
    isRecord(payload) &&
    payload.kind === "log_match" &&
    typeof payload.processId === "string" &&
    typeof payload.timestamp === "number" &&
    isRecord(payload.logMatch) &&
    typeof payload.logMatch.line === "string"
  );
}

function isCommandPinPayload(payload: unknown): payload is CommandPinPayload {
  return (
    isRecord(payload) &&
    (typeof payload.id === "string" || payload.id === null) &&
    typeof payload.reply === "function"
  );
}

function safeReply<T>(reply: (result: T) => void, result: T): void {
  try {
    reply(result);
  } catch {
    // Reply callbacks are owned by the requester.
    return;
  }
}
