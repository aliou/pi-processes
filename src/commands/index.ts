import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { LogStreamComponent } from "../components/log-stream-component";
import { ProcessPickerComponent } from "../components/process-picker-component";
import { ProcessesComponent } from "../components/processes-component";
import { LIVE_STATUSES, type ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";

const LOG_STREAM_WIDGET_ID = "processes-log-stream";

function runningProcessCompletions(manager: ProcessManager) {
  return (prefix: string) => {
    const processes = manager.list();
    const lower = prefix.toLowerCase();
    return processes
      .filter(
        (p) =>
          LIVE_STATUSES.has(p.status) &&
          (p.id.toLowerCase().startsWith(lower) ||
            p.name.toLowerCase().startsWith(lower)),
      )
      .map((p) => ({
        value: p.id,
        label: p.id,
        description: p.name,
      }));
  };
}

function allProcessCompletions(manager: ProcessManager) {
  return (prefix: string) => {
    const processes = manager.list();
    const lower = prefix.toLowerCase();
    return processes
      .filter(
        (p) =>
          p.id.toLowerCase().startsWith(lower) ||
          p.name.toLowerCase().startsWith(lower),
      )
      .map((p) => ({
        value: p.id,
        label: p.id,
        description: p.name,
      }));
  };
}

export function setupProcessesCommands(
  pi: ExtensionAPI,
  manager: ProcessManager,
): void {
  let streamingProcessId: string | null = null;

  // ── /process:list ──────────────────────────────────────────────────
  // Registered first so it appears first in autocomplete.
  pi.registerCommand("process:list", {
    description: "View and manage background processes",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/process:list requires interactive mode", "error");
        return;
      }

      // If currently streaming, dismiss the stream widget and show the list.
      if (streamingProcessId) {
        ctx.ui.setWidget(LOG_STREAM_WIDGET_ID, undefined);
        streamingProcessId = null;
      }

      const result = await ctx.ui.custom<string | null>(
        (tui, theme, _keybindings, done) => {
          return new ProcessesComponent(
            tui,
            theme,
            (processId?: string) => {
              if (processId) {
                done(processId);
              } else {
                done(null);
              }
            },
            manager,
          );
        },
      );

      // RPC fallback.
      if (result === undefined) {
        ctx.ui.notify("/process:list requires interactive mode", "info");
        return;
      }

      // User dismissed with Escape/q.
      if (result === null) {
        return;
      }

      // User selected a process — start streaming its logs.
      startStreaming(ctx.ui, manager, result);
    },
  });

  // ── /process:stream [id|name] ──────────────────────────────────────
  pi.registerCommand("process:stream", {
    description: "Stream logs from a running process",
    getArgumentCompletions: runningProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();

      // Explicit argument: stream that process.
      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          ctx.ui.notify(`Process not found: ${arg}`, "error");
          return;
        }
        if (!LIVE_STATUSES.has(proc.status)) {
          ctx.ui.notify(
            `${proc.name} (${proc.id}) is not running (${proc.status})`,
            "info",
          );
          return;
        }
        startStreaming(ctx.ui, manager, proc.id);
        return;
      }

      // No argument + currently streaming: dismiss.
      if (streamingProcessId) {
        ctx.ui.setWidget(LOG_STREAM_WIDGET_ID, undefined);
        streamingProcessId = null;
        return;
      }

      // No argument + not streaming: pick from running processes.
      const running = manager.list().filter((p) => LIVE_STATUSES.has(p.status));

      // No running processes.
      if (running.length === 0) {
        ctx.ui.notify("No running processes", "info");
        return;
      }

      // Single running process: auto-select.
      if (running.length === 1 && running[0]) {
        startStreaming(ctx.ui, manager, running[0].id);
        return;
      }

      // Multiple running processes: show picker.
      const processId = await pickProcess(
        ctx,
        manager,
        "Select process to stream",
        (p) => LIVE_STATUSES.has(p.status),
      );
      if (!processId) return;
      startStreaming(ctx.ui, manager, processId);
    },
  });

  // ── /process:logs [id|name] ────────────────────────────────────────
  pi.registerCommand("process:logs", {
    description: "Show log file paths for a process",
    getArgumentCompletions: allProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();

      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          ctx.ui.notify(`Process not found: ${arg}`, "error");
          return;
        }
        processId = proc.id;
      } else {
        // No argument: show picker.
        processId = await pickProcess(ctx, manager, "Select process for logs");
        if (!processId) return;
      }

      const logFiles = manager.getLogFiles(processId);
      const proc = manager.get(processId);
      if (!logFiles || !proc) {
        ctx.ui.notify(`Process not found: ${processId}`, "error");
        return;
      }

      ctx.ui.notify(
        `${proc.name} (${proc.id})\nstdout: ${logFiles.stdoutFile}\nstderr: ${logFiles.stderrFile}`,
        "info",
      );
    },
  });

  // ── /process:kill [id|name] ────────────────────────────────────────
  pi.registerCommand("process:kill", {
    description: "Kill a running background process",
    getArgumentCompletions: runningProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();

      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          ctx.ui.notify(`Process not found: ${arg}`, "error");
          return;
        }
        if (!LIVE_STATUSES.has(proc.status)) {
          ctx.ui.notify(
            `${proc.name} (${proc.id}) is not running (${proc.status})`,
            "info",
          );
          return;
        }
        processId = proc.id;
      } else {
        // No argument: show picker (only running processes).
        const running = manager
          .list()
          .filter((p) => LIVE_STATUSES.has(p.status));

        if (running.length === 0) {
          ctx.ui.notify("No running processes to kill", "info");
          return;
        }

        if (running.length === 1 && running[0]) {
          processId = running[0].id;
        } else {
          processId = await pickProcess(
            ctx,
            manager,
            "Select process to kill",
            (p) => LIVE_STATUSES.has(p.status),
          );
          if (!processId) return;
        }
      }

      const proc = manager.get(processId);
      if (!proc) {
        ctx.ui.notify(`Process not found: ${processId}`, "error");
        return;
      }

      const signal =
        proc.status === "terminate_timeout" ? "SIGKILL" : "SIGTERM";
      const timeoutMs = signal === "SIGKILL" ? 200 : 3000;
      const result = await manager.kill(processId, { signal, timeoutMs });

      if (result.ok) {
        ctx.ui.notify(`Killed ${proc.name} (${proc.id})`, "info");
      } else {
        ctx.ui.notify(
          `Failed to kill ${proc.name} (${proc.id}): ${result.reason}`,
          "error",
        );
      }
    },
  });

  // ── /process:clear ─────────────────────────────────────────────────
  pi.registerCommand("process:clear", {
    description: "Clear finished processes",
    handler: async (_args, ctx) => {
      const cleared = manager.clearFinished();
      if (cleared > 0) {
        ctx.ui.notify(
          `Cleared ${cleared} finished process${cleared > 1 ? "es" : ""}`,
          "info",
        );
      } else {
        ctx.ui.notify("No finished processes to clear", "info");
      }
    },
  });

  // ── Helpers ────────────────────────────────────────────────────────

  function startStreaming(
    ui: ExtensionCommandContext["ui"],
    mgr: ProcessManager,
    processId: string,
  ) {
    streamingProcessId = processId;
    ui.setWidget(
      LOG_STREAM_WIDGET_ID,
      (tui: { requestRender: () => void }, theme: Theme) => {
        return new LogStreamComponent(tui, theme, mgr, processId);
      },
      { placement: "aboveEditor" },
    );
  }
}

async function pickProcess(
  ctx: ExtensionCommandContext,
  manager: ProcessManager,
  title: string,
  filter?: (proc: ProcessInfo) => boolean,
): Promise<string | undefined> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Interactive mode required", "error");
    return undefined;
  }

  const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    return new ProcessPickerComponent(
      tui,
      theme,
      (processId?: string) => {
        done(processId ?? null);
      },
      manager,
      title,
      filter,
    );
  });

  // RPC fallback or user cancelled.
  if (result === undefined || result === null) {
    return undefined;
  }

  return result;
}
