import type {
  EventBus,
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { ProcessProtocolConfig } from "../../../src/protocol";
import type { ProcessInfo } from "../../../src/types";
import { sanitizeForDisplay } from "../../shared/display-text";
import { requestConfig, requestProcess, requestProcessList } from "../client";
import { OverviewComponent } from "../components/overview-component";

export interface OpenOverviewOptions {
  events: EventBus;
  registerOverlay: (overlay: { dispose: () => void }) => () => void;
}

/**
 * Register the `/ps` overview/control panel.
 *
 * `/ps` replaces the editor while open (non-overlay `ctx.ui.custom`). It lives
 * in the core extension but talks to the manager exclusively over `pi.events`
 * protocol channels, so a future split-out stays cheap.
 */
export function registerOverviewCommand(
  pi: Pick<ExtensionAPI, "registerCommand">,
  options: OpenOverviewOptions,
): void {
  pi.registerCommand("ps", {
    description: "Open the managed process overview panel.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      await openOverview(args, ctx, options);
    },
  });
}

async function openOverview(
  args: string,
  ctx: ExtensionCommandContext,
  options: OpenOverviewOptions,
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

  if (ctx.mode !== "tui") {
    const processes = requestProcessList(options.events);
    const message = formatPlainProcessList(processes);
    if (ctx.hasUI) ctx.ui.notify(message, "info");
    else console.log(message);
    return;
  }

  let config: ProcessProtocolConfig;
  try {
    config = requestConfig(options.events);
  } catch (error) {
    ctx.ui.notify(String(error), "error");
    return;
  }

  const result = await ctx.ui.custom<"closed">(
    (tui, theme: Theme, _keybindings, done) => {
      let unregister: () => void = () => undefined;
      const overlay = new OverviewComponent({
        events: options.events,
        tui,
        theme,
        config,
        initialProcessId,
        onClose: () => {
          unregister();
          done("closed");
        },
      });
      unregister = options.registerOverlay(overlay);
      return overlay;
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
        `${process.id}\t${sanitizeForDisplay(process.name)}\t${process.status}\t${sanitizeForDisplay(process.command)}`,
    )
    .join("\n");
}
