import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";

export function setupProcessStatusUpdater(
  pi: ExtensionAPI,
  manager: ProcessManager,
) {
  let latestContext: ExtensionContext | null = null;

  // Capture context from session events
  pi.on("session_start", async (_event, ctx) => {
    latestContext = ctx;
    updateStatus(ctx);
  });

  pi.on("turn_start", async (_event, ctx) => {
    latestContext = ctx;
  });

  pi.on("turn_end", async (_event, ctx) => {
    latestContext = ctx;
  });

  // Hook into process end to update status
  const originalOnProcessEnd = manager.onProcessEnd;
  manager.onProcessEnd = (info) => {
    // Call original callback if it exists
    originalOnProcessEnd?.call(manager, info);

    // Update status
    if (latestContext) {
      updateStatus(latestContext);
    }
  };

  // Return function for manual status updates (on start/clear)
  return {
    update: () => {
      if (latestContext) {
        updateStatus(latestContext);
      }
    },
  };

  function updateStatus(ctx: ExtensionContext) {
    const processes = manager.list();

    if (processes.length === 0) {
      ctx.ui.setStatus("processes", undefined);
      return;
    }

    const running = processes.filter((p) => p.status === "running").length;
    const succeeded = processes.filter(
      (p) => p.status !== "running" && p.success === true,
    ).length;
    const failed = processes.filter(
      (p) => p.status !== "running" && p.success === false,
    ).length;

    const parts: string[] = [];

    if (running > 0) {
      parts.push(ctx.ui.theme.fg("accent", `${running} running`));
    }

    if (succeeded > 0) {
      parts.push(ctx.ui.theme.fg("dim", `${succeeded} done`));
    }

    if (failed > 0) {
      parts.push(ctx.ui.theme.fg("error", `${failed} failed`));
    }

    const prefix = ctx.ui.theme.fg("dim", "processes: ");
    const statusText = prefix + parts.join(ctx.ui.theme.fg("dim", " • "));
    ctx.ui.setStatus("processes", statusText);
  }
}
