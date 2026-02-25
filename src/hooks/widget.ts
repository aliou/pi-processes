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
import type { DockStateManager } from "../state/dock-state";

const STATUS_WIDGET_ID = "processes-status";
const LOG_DOCK_WIDGET_ID = "processes-dock";

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

    // Check if adding this part would exceed the width
    const needed =
      includedCount > 0 ? separatorLen + formattedLen : formattedLen;

    // If there are more processes after this one, reserve space for the
    // overflow suffix (separator + "+N more") so the final line fits.
    let reservedForSuffix = 0;
    if (remaining > 0) {
      const suffixText = `+${remaining} more`;
      reservedForSuffix = separatorLen + visibleWidth(suffixText);
    }

    if (
      currentLen + needed + reservedForSuffix > effectiveMax &&
      includedCount > 0
    ) {
      // Show how many are hidden
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

  // Edge case: the very first element was too wide and the loop's overflow
  // check was skipped (it only fires when includedCount > 0). The suffix
  // reservation already shrinks the budget, but a single process that fills
  // the whole line still slips through. Show it truncated rather than nothing.
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
  dockState: DockStateManager,
) {
  let latestContext: ExtensionContext | null = null;
  let logDockComponent: LogDockComponent | null = null;

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
    const state = dockState.getState();

    if (!latestContext?.hasUI) return;

    if (state.visibility === "hidden") {
      latestContext.ui.setWidget(LOG_DOCK_WIDGET_ID, undefined);
      return;
    }

    // Create or update the dock component
    const dockHeight = config.widget.dockHeight;

    // Set widget height based on visibility state
    const widgetHeight = state.visibility === "collapsed" ? 3 : dockHeight;

    // Capture current context for the closure
    const ctx = latestContext;

    ctx.ui.setWidget(
      LOG_DOCK_WIDGET_ID,
      (tui: { requestRender: () => void }, theme: typeof ctx.ui.theme) => {
        // Dispose old component if exists
        logDockComponent?.dispose();

        logDockComponent = new LogDockComponent({
          manager,
          dockState,
          theme,
          tui,
          dockHeight: widgetHeight,
        });
        return logDockComponent;
      },
      { placement: "aboveEditor" },
    );
  }

  // Listen to process events for auto-show/hide
  manager.onEvent((event) => {
    if (event.type === "process_started") {
      // Auto-show dock when first process starts and follow is enabled
      dockState.autoShow();
    }

    if (event.type === "process_ended") {
      // Handle focus when process exits
      dockState.handleProcessExit(event.info.id);

      // Auto-hide dock when all processes finish (if follow enabled)
      const running = manager.list().filter((p) => LIVE_STATUSES.has(p.status));
      if (running.length === 0 && config.follow.autoHideOnFinish) {
        dockState.autoHide();
      }
    }

    // Update widgets on any event
    updateWidget();
  });

  // Subscribe to dock state changes
  dockState.subscribe(() => {
    updateWidget();
  });

  pi.on("session_start", async (_event, ctx) => {
    // Startup defer: capture context only. First render happens on process
    // manager events or explicit settings updates.
    latestContext = ctx;
  });

  pi.on("session_switch", async (_event, ctx) => {
    latestContext = ctx;
    updateWidget();
  });

  return {
    update: updateWidget,
  };
}
