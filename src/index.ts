import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setupProcessesCommands } from "./commands";
import { setupProcessesHooks } from "./hooks";
import { ProcessManager } from "./manager";
import { setupProcessesTools } from "./tools";

export default function (pi: ExtensionAPI) {
  if (process.platform === "win32") {
    pi.on("session_start", async (_event, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.notify("processes extension not available on Windows", "warning");
    });
    return;
  }

  const manager = new ProcessManager();

  setupProcessesHooks(pi, manager);
  setupProcessesTools(pi, manager);
  setupProcessesCommands(pi, manager);
}
