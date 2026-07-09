import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { requestClear } from "../client";

/**
 * Register `/ps:clear`.
 *
 * Removes finished processes from the list via the clear protocol channel,
 * mirroring main's behavior. Returns the count of cleared processes.
 */
export function registerClearCommand(pi: ExtensionAPI): void {
  const events = pi.events;
  pi.registerCommand("ps:clear", {
    description: "Remove finished processes from the list.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const cleared = requestClear(events);
      if (cleared === 0) {
        ctx.ui.notify("No finished processes to clear.", "info");
        return;
      }
      ctx.ui.notify(
        `Cleared ${cleared} finished process${cleared === 1 ? "" : "es"}.`,
        "info",
      );
    },
  });
}
