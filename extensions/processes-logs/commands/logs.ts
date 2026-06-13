import type {
  EventBus,
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { ProcessInfo } from "../../../src/types";
import { requestProcess, requestProcessList } from "../client";
import { allProcessCompletions } from "../completions";
import { LogOverlayComponent } from "../components/log-overlay-component";

export interface OpenLogsOptions {
  events: EventBus;
  registerOverlay: (overlay: { dispose: () => void }) => () => void;
}

export function registerLogsCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  options: OpenLogsOptions,
): void {
  const command = {
    description: "Open managed process logs.",
    getArgumentCompletions: allProcessCompletions(options.events),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await openLogs(args, ctx, options);
    },
  };

  pi.registerCommand("ps:logs", command);
}

async function openLogs(
  args: string,
  ctx: ExtensionCommandContext,
  options: OpenLogsOptions,
): Promise<void> {
  const requestedId = args.trim().split(/\s+/, 1)[0] || undefined;
  const initialProcessId = requestedId
    ? requestProcess(options.events, requestedId)?.id
    : undefined;

  if (requestedId && !initialProcessId) {
    const message = `Process not found: ${requestedId}`;
    if (ctx.hasUI) ctx.ui.notify(message, "warning");
    else console.log(message);
    return;
  }

  if (!ctx.hasUI) {
    const processes = requestProcessList(options.events);
    console.log(formatPlainProcessList(processes));
    return;
  }

  const result = await ctx.ui.custom<"closed">(
    (tui, theme: Theme, _keybindings, done) => {
      let unregister: () => void = () => undefined;
      const overlay = new LogOverlayComponent({
        events: options.events,
        tui,
        theme,
        initialProcessId,
        onClose: () => {
          unregister();
          done("closed");
        },
      });
      unregister = options.registerOverlay(overlay);
      return overlay;
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "90%",
        maxHeight: "90%",
        margin: 2,
      },
    },
  );

  if (result === undefined) {
    const processes = requestProcessList(options.events);
    ctx.ui.notify(formatPlainProcessList(processes), "info");
  }
}

function formatPlainProcessList(processes: ProcessInfo[]): string {
  if (processes.length === 0) return "No managed processes.";
  return processes
    .map(
      (process) =>
        `${process.id}\t${process.name}\t${process.status}\t${process.command}`,
    )
    .join("\n");
}
