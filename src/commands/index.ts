/**
 * Process commands with /ps: prefix.
 *
 * /ps         - Open full panel to view and manage processes
 * /ps:focus   - Focus on a specific process (opens dock)
 * /ps:kill    - Kill a running process
 * /ps:clear   - Clear finished processes
 * /ps:logs    - Show log file paths
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { ProcessPickerComponent } from "../components/process-picker-component";
import { ProcessesComponent } from "../components/processes-component";
import { LIVE_STATUSES, type ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import type { DockStateManager } from "../state/dock-state";

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
  dockState: DockStateManager,
): void {
  // ── /ps ─────────────────────────────────────────────────────────────
  // Open full panel to view and manage processes
  pi.registerCommand("ps", {
    description: "View and manage background processes",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }

      const result = await ctx.ui.custom<string | null>(
        (tui, theme, _keybindings, done) => {
          return new ProcessesComponent(
            tui,
            theme,
            (processId?: string) => {
              if (processId) {
                dockState.setFocus(processId);
              }
              done(processId ?? null);
            },
            manager,
          );
        },
      );

      if (result === undefined) {
        return;
      }
    },
  });

  // ── /ps:focus [id|name] ────────────────────────────────────────────
  pi.registerCommand("ps:focus", {
    description: "Focus on a process to view its logs in the dock",
    getArgumentCompletions: allProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();

      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          return;
        }
        processId = proc.id;
      } else {
        processId = await pickProcess(ctx, manager, "Select process to focus");
        if (!processId) return;
      }

      // Focus on the process (auto-shows dock if hidden)
      dockState.setFocus(processId);
    },
  });

  // ── /ps:logs [id|name] ─────────────────────────────────────────────
  pi.registerCommand("ps:logs", {
    description: "Show log file paths for a process",
    getArgumentCompletions: allProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();

      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          return;
        }
        processId = proc.id;
      } else {
        processId = await pickProcess(ctx, manager, "Select process for logs");
        if (!processId) return;
      }

      // Focus on the process and expand dock to show logs
      dockState.setState({
        focusedProcessId: processId,
        visibility: "open",
      });
    },
  });

  // ── /ps:kill [id|name] ─────────────────────────────────────────────
  pi.registerCommand("ps:kill", {
    description: "Kill a running background process",
    getArgumentCompletions: runningProcessCompletions(manager),
    handler: async (args, ctx) => {
      const arg = args.trim();

      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          return;
        }
        if (!LIVE_STATUSES.has(proc.status)) {
          return;
        }
        processId = proc.id;
      } else {
        // No argument: show picker (only running processes).
        const running = manager
          .list()
          .filter((p) => LIVE_STATUSES.has(p.status));

        if (running.length === 0) {
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
        return;
      }

      const signal =
        proc.status === "terminate_timeout" ? "SIGKILL" : "SIGTERM";
      const timeoutMs = signal === "SIGKILL" ? 200 : 3000;
      const result = await manager.kill(processId, { signal, timeoutMs });

      if (result.ok) {
        if (dockState.getState().focusedProcessId === processId) {
          dockState.setFocus(null);
        }
      }
    },
  });

  // ── /ps:clear ─────────────────────────────────────────────────────
  pi.registerCommand("ps:clear", {
    description: "Clear finished processes",
    handler: async (_args, _ctx) => {
      manager.clearFinished();
    },
  });

  // ── /ps:dock [on|off|expanded] ─────────────────────────────────────
  pi.registerCommand("ps:dock", {
    description: "Toggle dock visibility (on/off/expanded)",
    getArgumentCompletions: () => [
      { value: "on", label: "on" },
      { value: "off", label: "off" },
      { value: "expanded", label: "expanded" },
    ],
    handler: async (args, _ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "on") {
        dockState.expand();
      } else if (arg === "off") {
        dockState.hide();
      } else if (arg === "expanded") {
        dockState.expand();
      } else {
        dockState.toggleVisibility();
      }
    },
  });

  // ── Deprecated commands (backward compatible) ─────────────────────
  pi.registerCommand("process:list", {
    description: "[DEPRECATED] Use /ps instead",
    handler: async (_args, _ctx) => {
      // Same as /ps - open panel
    },
  });

  pi.registerCommand("process:stream", {
    description: "[DEPRECATED] Use /ps:focus instead",
    handler: async (args, ctx) => {
      // Same as /ps:focus
      const arg = args.trim();
      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          return;
        }
        processId = proc.id;
      } else {
        processId = await pickProcess(ctx, manager, "Select process to stream");
        if (!processId) return;
      }

      dockState.setFocus(processId);
    },
  });

  pi.registerCommand("process:logs", {
    description: "[DEPRECATED] Use /ps:logs instead",
    handler: async (args, ctx) => {
      // Same as /ps:logs
      const arg = args.trim();
      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          return;
        }
        processId = proc.id;
      } else {
        processId = await pickProcess(ctx, manager, "Select process for logs");
        if (!processId) return;
      }

      dockState.setState({
        focusedProcessId: processId,
        visibility: "open",
      });
    },
  });

  pi.registerCommand("process:kill", {
    description: "[DEPRECATED] Use /ps:kill instead",
    handler: async (args, ctx) => {
      // Same as /ps:kill
      const arg = args.trim();

      let processId: string | undefined;

      if (arg) {
        const proc = manager.find(arg);
        if (!proc) {
          return;
        }
        if (!LIVE_STATUSES.has(proc.status)) {
          return;
        }
        processId = proc.id;
      } else {
        const running = manager
          .list()
          .filter((p) => LIVE_STATUSES.has(p.status));

        if (running.length === 0) {
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
        return;
      }

      const signal =
        proc.status === "terminate_timeout" ? "SIGKILL" : "SIGTERM";
      const timeoutMs = signal === "SIGKILL" ? 200 : 3000;
      const result = await manager.kill(processId, { signal, timeoutMs });

      if (result.ok) {
        if (dockState.getState().focusedProcessId === processId) {
          dockState.setFocus(null);
        }
      }
    },
  });

  pi.registerCommand("process:clear", {
    description: "[DEPRECATED] Use /ps:clear instead",
    handler: async (_args, _ctx) => {
      // Same as /ps:clear
      manager.clearFinished();
    },
  });
}

async function pickProcess(
  ctx: ExtensionCommandContext,
  manager: ProcessManager,
  title: string,
  filter?: (proc: ProcessInfo) => boolean,
): Promise<string | undefined> {
  if (!ctx.hasUI) {
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

  if (result === undefined || result === null) {
    return undefined;
  }

  return result;
}
