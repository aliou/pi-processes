import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isWindowsPlatform } from "../../src/utils/platform";
import { CHANNELS, type CommandOpenLogsPayload } from "../shared/protocol";
import {
  handleOpenLogsCommand,
  type OpenLogsOptions,
  registerLogsCommand,
} from "./commands/logs";

export default async function processesLogsExtension(
  pi: ExtensionAPI,
): Promise<void> {
  // The core extension no-ops on Windows; without the manager's protocol
  // handlers there is nothing for the logs overlay to subscribe to, so bail
  // silently. The core extension already surfaced a warning.
  if (isWindowsPlatform()) return;

  const openOverlays = new Set<{ dispose: () => void }>();

  const options: OpenLogsOptions = {
    events: pi.events,
    registerOverlay: (overlay) => {
      openOverlays.add(overlay);
      return () => openOverlays.delete(overlay);
    },
  };

  registerLogsCommand(pi, options);

  let disposeOpenLogsCommand: (() => void) | null = null;

  pi.on("session_start", (_event, ctx) => {
    disposeOpenLogsCommand?.();
    disposeOpenLogsCommand = pi.events.on(
      CHANNELS.COMMAND_OPEN_LOGS,
      (payload) => {
        const command = payload as CommandOpenLogsPayload;
        void handleOpenLogsCommand(
          ctx,
          options,
          command.processId,
          command.reply,
        );
      },
    );
  });

  pi.on("session_shutdown", () => {
    disposeOpenLogsCommand?.();
    disposeOpenLogsCommand = null;
    for (const overlay of [...openOverlays]) overlay.dispose();
    openOverlays.clear();
  });
}
