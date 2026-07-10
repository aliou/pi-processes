import {
  type EventBus,
  type ExtensionAPI,
  type ExtensionCommandContext,
  getSelectListTheme,
} from "@earendil-works/pi-coding-agent";
import {
  type AutocompleteItem,
  type SelectItem,
  SelectList,
} from "@earendil-works/pi-tui";
import { LIVE_STATUSES } from "../../../src/types";
import { formatProcessSelectionDescription } from "../../shared/ui";
import { requestKill, requestProcess, requestProcessList } from "../client";

/**
 * Register `/ps:kill`.
 *
 * Stops a running managed process via the kill protocol channel. With no
 * argument it picks a target from the live processes (or kills the sole
 * running one outright); with an explicit id it stops that one. The dock
 * auto-unpins a killed focused process on the next processes-changed tick, so
 * this command does not touch the dock directly.
 */
export function registerKillCommand(pi: ExtensionAPI): void {
  const events = pi.events;
  pi.registerCommand("ps:kill", {
    description: "Stop a running managed process.",
    getArgumentCompletions: (prefix: string) => completions(events, prefix),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const rawId = args.trim().split(/\s+/, 1)[0];
      const processes = requestProcessList(events);
      const live = processes.filter((process) =>
        LIVE_STATUSES.has(process.status),
      );

      let id: string | null = null;
      if (rawId) {
        const proc = requestProcess(events, rawId);
        if (!proc) {
          ctx.ui.notify(`Process not found: ${rawId}`, "warning");
          return;
        }
        if (!LIVE_STATUSES.has(proc.status)) {
          ctx.ui.notify(`${proc.name} (${proc.id}) is not running.`, "warning");
          return;
        }
        id = proc.id;
      } else if (live.length === 0) {
        ctx.ui.notify("No running processes to kill.", "warning");
        return;
      } else if (live.length === 1 && live[0]) {
        id = live[0].id;
      } else {
        id = await pickTarget(ctx, events, "Select process to kill");
        if (!id) return;
      }

      if (!id) return;
      const proc = requestProcess(events, id);
      if (!proc) {
        ctx.ui.notify(`Process not found: ${id}`, "warning");
        return;
      }

      const signal =
        proc.status === "terminate_timeout" ? "SIGKILL" : "SIGTERM";
      const timeoutMs = signal === "SIGKILL" ? 200 : 3000;
      const result = await requestKill(events, id, { signal, timeoutMs });
      if (result.ok) {
        ctx.ui.notify(`Killed ${proc.name} (${proc.id}).`, "info");
      } else {
        ctx.ui.notify(
          `Failed to kill ${proc.name} (${proc.id}): ${result.reason}.`,
          "warning",
        );
      }
    },
  });
}

async function pickTarget(
  ctx: ExtensionCommandContext,
  events: EventBus,
  title: string,
): Promise<string | null> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Usage: /ps:kill <process-id>", "warning");
    return null;
  }

  const items: SelectItem[] = requestProcessList(events)
    .filter((process) => LIVE_STATUSES.has(process.status))
    .map((process) => ({
      label: `${process.name} (${process.id})`,
      value: process.id,
      description: formatProcessSelectionDescription(process),
    }));

  if (items.length === 0) {
    ctx.ui.notify("No running processes to kill.", "warning");
    return null;
  }

  const result = await ctx.ui.custom<string | null>(
    (tui, theme, _keybindings, done) => {
      const list = new SelectList(
        items,
        Math.min(items.length, 10),
        getSelectListTheme(),
      );
      list.onSelect = (item) => done(String(item.value));
      list.onCancel = () => done(null);

      return {
        render: (width: number) => [
          theme.fg("accent", title),
          theme.fg("muted", "─".repeat(Math.max(0, width))),
          ...list.render(width),
          theme.fg("muted", "─".repeat(Math.max(0, width))),
        ],
        invalidate: () => list.invalidate(),
        handleInput: (data: string) => {
          list.handleInput(data);
          tui.requestRender();
        },
      };
    },
  );

  return result ?? null;
}

function completions(
  events: EventBus,
  prefix: string,
): AutocompleteItem[] | null {
  const normalized = prefix.trim().toLowerCase();
  const items = requestProcessList(events)
    .filter(
      (process) =>
        LIVE_STATUSES.has(process.status) &&
        (process.id.toLowerCase().startsWith(normalized) ||
          process.name.toLowerCase().includes(normalized)),
    )
    .map((process) => ({
      value: process.id,
      label: `${process.name} (${process.id})`,
      description: formatProcessSelectionDescription(process),
    }));
  return items.length > 0 ? items : null;
}
