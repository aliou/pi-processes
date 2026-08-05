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
import {
  formatProcessSelectionDescription,
  formatProcessSelectionLabel,
} from "../../shared/ui";
import { requestProcess, requestProcessList } from "../client";
import type { DockController } from "../widget/setup";

export function registerPinCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  events: EventBus,
  getController: () => DockController | null,
): void {
  pi.registerCommand("ps:pin", {
    description: "Pin the process dock to a process.",
    getArgumentCompletions: (prefix: string) =>
      completions(
        events,
        prefix,
        getController()?.actions.getFocusedProcessId() ?? null,
      ),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const controller = getController();
      if (!controller) {
        report(ctx, "Process dock is only available in UI mode.", "warning");
        return;
      }

      const rawId = args.trim().split(/\s+/, 1)[0];
      const pickedId = rawId
        ? rawId
        : await pickPinTarget(ctx, events, controller);
      if (!pickedId) return;
      const id = pickedId;

      if (id === "clear") {
        controller.actions.setFocus(null);
        controller.actions.expand();
        controller.refresh();
        return;
      }

      const process = requestProcess(events, id);
      if (!process) {
        report(ctx, `Process not found: ${id}`, "warning");
        return;
      }

      controller.actions.setFocus(process.id);
      controller.actions.expand();
      controller.refresh();
    },
  });
}

async function pickPinTarget(
  ctx: ExtensionCommandContext,
  events: EventBus,
  controller: DockController,
): Promise<string | null> {
  if (ctx.mode !== "tui") {
    report(ctx, "Usage: /ps:pin <process-id|clear>", "warning");
    return null;
  }

  const pinnedProcessId = controller.actions.getFocusedProcessId();
  const processes = requestProcessList(events);
  const items: SelectItem[] = [
    ...(pinnedProcessId
      ? [
          {
            label: "clear",
            value: "clear",
            description: "Unpin the dock and show all running process logs.",
          },
        ]
      : []),
    ...processes.map((process) => ({
      label: formatProcessSelectionLabel(process),
      value: process.id,
      description: formatProcessSelectionDescription(
        process,
        process.id === pinnedProcessId ? " — pinned" : "",
      ),
    })),
  ];

  if (items.length === 0) {
    report(ctx, "No processes to pin.", "warning");
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
  pinnedProcessId: string | null,
): AutocompleteItem[] | null {
  const normalized = prefix.trim().toLowerCase();
  const clearItems =
    pinnedProcessId && "clear".startsWith(normalized)
      ? [
          {
            value: "clear",
            label: "clear",
            description: "Unpin the dock and show all running process logs.",
          },
        ]
      : [];
  const processItems = requestProcessList(events)
    .filter(
      (process) =>
        process.id.toLowerCase().startsWith(normalized) ||
        process.name.toLowerCase().includes(normalized),
    )
    .map((process) => ({
      value: process.id,
      label: formatProcessSelectionLabel(process),
      description: formatProcessSelectionDescription(process),
    }));
  const items = [...clearItems, ...processItems];
  return items.length > 0 ? items : null;
}

function report(
  ctx: ExtensionCommandContext,
  message: string,
  level: "info" | "warning",
): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
  else console.log(message);
}
