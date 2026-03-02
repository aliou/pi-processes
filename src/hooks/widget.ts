/**
 * Process widget hook - manages both status widget and log dock.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { LogDockComponent } from "../components/log-dock-component";
import { configLoader, type ResolvedProcessesConfig } from "../config";
import { LIVE_STATUSES, type ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";

const STATUS_WIDGET_ID = "processes-status";
const LOG_DOCK_WIDGET_ID = "processes-dock";

// Internal types — not exported
type DockVisibility = "hidden" | "collapsed" | "open";

interface DockState {
  visibility: DockVisibility;
  followEnabled: boolean;
  focusedProcessId: string | null;
}

// Exported — the interface that commands receive
export interface DockActions {
  getFocusedProcessId(): string | null;
  isFollowEnabled(): boolean;
  setFocus(id: string | null): void;
  expand(): void;
  collapse(): void;
  hide(): void;
  toggle(): void;
  toggleFollow(): void;
}

function formatProcessStatus(
  proc: ProcessInfo,
  theme: ExtensionContext["ui"]["theme"],
): string {
  const name =
    proc.name.length > 20 ? `${proc.name.slice(0, 17)}...` : proc.name;

  switch (proc.status) {
    case "running":
      return `${theme.fg("accent", name)} ${theme.fg("dim", "running")}`;
    case "terminating":
      return `${theme.fg("warning", name)} ${theme.fg("dim", "terminating")}`;
    case "terminate_timeout":
      return `${theme.fg("error", name)} ${theme.fg("error", "terminate_timeout")}`;
    case "killed":
      return `${theme.fg("warning", name)} ${theme.fg("dim", "killed")}`;
    case "exited":
      if (proc.success) {
        return `${theme.fg("dim", name)} ${theme.fg("success", "done")}`;
      }
      return `${theme.fg("error", name)} ${theme.fg("error", `exit(${proc.exitCode ?? "?"})`)}`;
    default:
      return `${theme.fg("dim", name)} ${theme.fg("dim", proc.status)}`;
  }
}

function renderStatusWidget(
  processes: ProcessInfo[],
  theme: ExtensionContext["ui"]["theme"],
  maxWidth?: number,
): string[] {
  if (processes.length === 0) {
    return [];
  }

  const aliveish = processes.filter(
    (p) =>
      p.status === "running" ||
      p.status === "terminating" ||
      p.status === "terminate_timeout",
  );
  const finished = processes.filter(
    (p) =>
      p.status !== "running" &&
      p.status !== "terminating" &&
      p.status !== "terminate_timeout",
  );

  const allProcs: ProcessInfo[] = [
    ...aliveish,
    ...finished.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0)),
  ];

  const prefix = theme.fg("dim", "processes: ");
  const prefixLen = visibleWidth(prefix);
  const separator = theme.fg("dim", " | ");
  const separatorLen = visibleWidth(separator);
  const effectiveMax = maxWidth ?? 200;

  const parts: string[] = [];
  let currentLen = prefixLen;
  let includedCount = 0;

  for (const proc of allProcs) {
    const formatted = formatProcessStatus(proc, theme);
    const formattedLen = visibleWidth(formatted);
    const remaining = allProcs.length - includedCount - 1;

    const needed =
      includedCount > 0 ? separatorLen + formattedLen : formattedLen;

    let reservedForSuffix = 0;
    if (remaining > 0) {
      const suffixText = `+${remaining} more`;
      reservedForSuffix = separatorLen + visibleWidth(suffixText);
    }

    if (
      currentLen + needed + reservedForSuffix > effectiveMax &&
      includedCount > 0
    ) {
      const hiddenCount = allProcs.length - includedCount;
      if (hiddenCount > 0) {
        parts.push(theme.fg("dim", `+${hiddenCount} more`));
      }
      break;
    }

    parts.push(formatted);
    currentLen += needed;
    includedCount++;
  }

  if (includedCount === 0 && allProcs.length > 0) {
    const formatted = formatProcessStatus(allProcs[0], theme);
    parts.push(formatted);
  }

  if (parts.length === 0) {
    return [];
  }

  const line = prefix + parts.join(separator);
  return [
    visibleWidth(line) > effectiveMax
      ? truncateToWidth(line, effectiveMax)
      : line,
  ];
}

export function setupProcessWidget(
  pi: ExtensionAPI,
  manager: ProcessManager,
  config: ResolvedProcessesConfig,
) {
  let latestContext: ExtensionContext | null = null;
  let logDockComponent: LogDockComponent | null = null;
  let logDockComponentTui: { requestRender(): void } | null = null;

  // Internal state — plain mutable object
  const dockState: DockState = {
    visibility: "hidden",
    followEnabled: config.follow.enabledByDefault,
    focusedProcessId: null,
  };

  function updateWidget() {
    if (!latestContext?.hasUI) return;

    // Update status widget
    if (!configLoader.getConfig().widget.showStatusWidget) {
      latestContext.ui.setWidget(STATUS_WIDGET_ID, undefined);
    } else {
      const processes = manager.list();
      const maxWidth = process.stdout.columns || 120;
      const lines = renderStatusWidget(
        processes,
        latestContext.ui.theme,
        maxWidth,
      );

      if (lines.length === 0) {
        latestContext.ui.setWidget(STATUS_WIDGET_ID, undefined);
      } else {
        latestContext.ui.setWidget(STATUS_WIDGET_ID, lines, {
          placement: "belowEditor",
        });
      }
    }

    // Update log dock widget
    if (!latestContext?.hasUI) return;

    if (dockState.visibility === "hidden") {
      latestContext.ui.setWidget(LOG_DOCK_WIDGET_ID, undefined);
      if (logDockComponent) {
        logDockComponent.dispose();
        logDockComponent = null;
        logDockComponentTui = null;
      }
      return;
    }

    const mode = dockState.visibility as "collapsed" | "open";
    const height = mode === "collapsed" ? 3 : config.widget.dockHeight;

    if (logDockComponent && logDockComponentTui) {
      // Component already exists — just update its state.
      logDockComponent.update({
        mode,
        focusedProcessId: dockState.focusedProcessId,
        dockHeight: height,
      });
    } else {
      // First time showing (or after a session switch destroyed it).
      const ctx = latestContext;
      ctx.ui.setWidget(
        LOG_DOCK_WIDGET_ID,
        (tui: { requestRender(): void }, theme: typeof ctx.ui.theme) => {
          logDockComponent = new LogDockComponent({
            manager,
            tui,
            theme,
            mode,
            focusedProcessId: dockState.focusedProcessId,
            dockHeight: height,
          });
          logDockComponentTui = tui;
          return logDockComponent;
        },
        { placement: "aboveEditor" },
      );
    }
  }

  const dockActions: DockActions = {
    getFocusedProcessId: () => dockState.focusedProcessId,
    isFollowEnabled: () => dockState.followEnabled,

    setFocus(id) {
      dockState.focusedProcessId = id;
      if (id && dockState.visibility === "hidden")
        dockState.visibility = "open";
      updateWidget();
    },

    expand() {
      dockState.visibility = "open";
      updateWidget();
    },

    collapse() {
      dockState.visibility = "collapsed";
      updateWidget();
    },

    hide() {
      dockState.visibility = "hidden";
      updateWidget();
    },

    toggle() {
      if (dockState.visibility === "hidden") dockState.visibility = "collapsed";
      else if (dockState.visibility === "collapsed")
        dockState.visibility = "open";
      else dockState.visibility = "collapsed";
      updateWidget();
    },

    toggleFollow() {
      dockState.followEnabled = !dockState.followEnabled;
      updateWidget();
    },
  };

  // Listen to process events for auto-show/hide
  manager.onEvent((event) => {
    if (event.type === "process_started") {
      // Auto-show dock when first process starts and follow is enabled.
      if (dockState.followEnabled && dockState.visibility === "hidden") {
        dockState.visibility = "collapsed";
      }
    }

    if (event.type === "process_ended") {
      // Unfocus if the focused process ended.
      if (dockState.focusedProcessId === event.info.id) {
        dockState.focusedProcessId = null;
      }
      // Auto-hide when last running process ends and follow is enabled.
      const running = manager.list().filter((p) => LIVE_STATUSES.has(p.status));
      if (
        running.length === 0 &&
        config.follow.autoHideOnFinish &&
        dockState.followEnabled
      ) {
        dockState.visibility = "hidden";
      }
    }

    updateWidget();
  });

  pi.on("session_start", async (_event, ctx) => {
    latestContext = ctx;
  });

  pi.on("session_switch", async (_event, ctx) => {
    // Destroy old component — new TUI context means we must recreate it.
    if (logDockComponent) {
      logDockComponent.dispose();
      logDockComponent = null;
      logDockComponentTui = null;
    }
    latestContext = ctx;
    updateWidget();
  });

  return { update: updateWidget, dockActions };
}
