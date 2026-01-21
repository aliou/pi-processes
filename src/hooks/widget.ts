import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { ProcessInfo, ProcessManager } from "../manager";

const WIDGET_ID = "processes-status";

function formatRuntime(startTime: number, endTime: number | null): string {
  const end = endTime ?? Date.now();
  const ms = end - startTime;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatProcessStatus(
  proc: ProcessInfo,
  theme: ExtensionContext["ui"]["theme"],
): string {
  const runtime = formatRuntime(proc.startTime, proc.endTime);
  const name =
    proc.name.length > 20 ? `${proc.name.slice(0, 17)}...` : proc.name;

  if (proc.status === "running") {
    return `${theme.fg("accent", name)} ${theme.fg("dim", runtime)}`;
  }
  if (proc.status === "killed") {
    return `${theme.fg("warning", name)} ${theme.fg("dim", "killed")}`;
  }
  if (proc.success) {
    return `${theme.fg("dim", name)} ${theme.fg("success", "done")}`;
  }
  return `${theme.fg("error", name)} ${theme.fg("error", `exit(${proc.exitCode ?? "?"})`)}`;
}

function renderWidget(
  processes: ProcessInfo[],
  theme: ExtensionContext["ui"]["theme"],
): string[] {
  if (processes.length === 0) {
    return [];
  }

  const running = processes.filter((p) => p.status === "running");
  const finished = processes.filter((p) => p.status !== "running");

  const parts: string[] = [];

  // Show running processes first
  for (const proc of running) {
    parts.push(formatProcessStatus(proc, theme));
  }

  // Show finished processes (most recent first, limit to 3)
  const recentFinished = finished
    .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))
    .slice(0, 3);

  for (const proc of recentFinished) {
    parts.push(formatProcessStatus(proc, theme));
  }

  // If there are more finished processes, show count
  const hiddenCount = finished.length - recentFinished.length;
  if (hiddenCount > 0) {
    parts.push(theme.fg("dim", `+${hiddenCount} more`));
  }

  const prefix = theme.fg("dim", "processes: ");
  return [prefix + parts.join(theme.fg("dim", " | "))];
}

export function setupProcessWidget(pi: ExtensionAPI, manager: ProcessManager) {
  let latestContext: ExtensionContext | null = null;
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  function updateWidget() {
    if (!latestContext?.hasUI) return;

    const processes = manager.list();
    const lines = renderWidget(processes, latestContext.ui.theme);

    if (lines.length === 0) {
      latestContext.ui.setWidget(WIDGET_ID, undefined);
    } else {
      latestContext.ui.setWidget(WIDGET_ID, lines, {
        placement: "belowEditor",
      });
    }
  }

  function startRefresh() {
    if (refreshInterval) return;
    refreshInterval = setInterval(() => {
      const hasRunning = manager.list().some((p) => p.status === "running");
      if (hasRunning) {
        updateWidget();
      }
    }, 1000);
  }

  function stopRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  // Capture context and update widget
  pi.on("session_start", async (_event, ctx) => {
    latestContext = ctx;
    updateWidget();
    startRefresh();
  });

  pi.on("session_switch", async (_event, ctx) => {
    latestContext = ctx;
    updateWidget();
  });

  pi.on("session_shutdown", async () => {
    stopRefresh();
  });

  // Chain into process end callback
  const originalOnProcessEnd = manager.onProcessEnd;
  manager.onProcessEnd = (info) => {
    originalOnProcessEnd?.call(manager, info);
    updateWidget();
  };

  return {
    update: updateWidget,
  };
}
