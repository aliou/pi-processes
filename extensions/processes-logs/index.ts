import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isWindowsPlatform } from "../../src/utils/platform";
import { registerLogsCommand } from "./commands/logs";

export default async function processesLogsExtension(
  pi: ExtensionAPI,
): Promise<void> {
  // The core extension no-ops on Windows; without the manager's protocol
  // handlers there is nothing for the logs overlay to subscribe to, so bail
  // silently. The core extension already surfaced a warning.
  if (isWindowsPlatform()) return;

  const openOverlays = new Set<{ dispose: () => void }>();

  registerLogsCommand(pi, {
    events: pi.events,
    registerOverlay: (overlay) => {
      openOverlays.add(overlay);
      return () => openOverlays.delete(overlay);
    },
  });

  pi.on("session_shutdown", () => {
    for (const overlay of [...openOverlays]) overlay.dispose();
    openOverlays.clear();
  });
}
