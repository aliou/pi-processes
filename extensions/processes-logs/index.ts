import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerLogsCommand } from "./commands/logs";

export default async function processesLogsExtension(
  pi: ExtensionAPI,
): Promise<void> {
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
