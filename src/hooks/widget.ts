import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import type { ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";

const WIDGET_ID = "processes-status";

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

function renderWidget(
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

    // Check if adding this part would exceed the width
    const needed =
      includedCount > 0 ? separatorLen + formattedLen : formattedLen;

    if (currentLen + needed > effectiveMax && includedCount > 0) {
      // Show how many are hidden
      const remaining = allProcs.length - includedCount;
      if (remaining > 0) {
        parts.push(theme.fg("dim", `+${remaining} more`));
      }
      break;
    }

    parts.push(formatted);
    currentLen += needed;
    includedCount++;
  }

  if (parts.length === 0) {
    return [];
  }

  return [prefix + parts.join(separator)];
}

export function setupProcessWidget(pi: ExtensionAPI, manager: ProcessManager) {
  let latestContext: ExtensionContext | null = null;

  function updateWidget() {
    if (!latestContext?.hasUI) return;

    const processes = manager.list();
    const maxWidth = process.stdout.columns || 120;
    const lines = renderWidget(processes, latestContext.ui.theme, maxWidth);

    if (lines.length === 0) {
      latestContext.ui.setWidget(WIDGET_ID, undefined);
    } else {
      latestContext.ui.setWidget(WIDGET_ID, lines, {
        placement: "belowEditor",
      });
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    latestContext = ctx;
    updateWidget();
  });

  pi.on("session_switch", async (_event, ctx) => {
    latestContext = ctx;
    updateWidget();
  });

  manager.onEvent(() => {
    updateWidget();
  });

  return {
    update: updateWidget,
  };
}
