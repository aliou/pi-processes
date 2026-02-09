import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { LogStreamComponent } from "../components/log-stream-component";
import { ProcessesComponent } from "../components/processes-component";
import type { ProcessManager } from "../manager";

const LOG_STREAM_WIDGET_ID = "processes-log-stream";

export function setupProcessesCommands(
  pi: ExtensionAPI,
  manager: ProcessManager,
) {
  // Track whether we're currently streaming logs.
  let isStreaming = false;

  pi.registerCommand("processes", {
    description: "View and manage background processes",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/processes requires interactive mode", "error");
        return;
      }

      // If currently streaming, dismiss the stream widget and show the list.
      if (isStreaming) {
        ctx.ui.setWidget(LOG_STREAM_WIDGET_ID, undefined);
        isStreaming = false;
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
        ctx.ui.notify("/processes requires interactive mode", "info");
        return;
      }

      // User dismissed with Escape/q.
      if (result === null) {
        return;
      }

      // User selected a process — start streaming its logs.
      isStreaming = true;
      ctx.ui.setWidget(
        LOG_STREAM_WIDGET_ID,
        (tui, theme) => {
          return new LogStreamComponent(tui, theme, manager, result);
        },
        { placement: "aboveEditor" },
      );
    },
  });
}
