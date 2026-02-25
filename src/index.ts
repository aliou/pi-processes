import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setupProcessesCommands } from "./commands";
import { registerProcessesSettings } from "./commands/settings-command";
import { configLoader } from "./config";
import { setupProcessesHooks } from "./hooks";
import { ProcessManager } from "./manager";
import { DockStateManager } from "./state/dock-state";
import { setupProcessesTools } from "./tools";

export default async function (pi: ExtensionAPI) {
  if (process.platform === "win32") {
    pi.on("session_start", async (_event, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.notify("processes extension not available on Windows", "warning");
    });
    return;
  }

  await configLoader.load();
  const manager = new ProcessManager({
    getConfiguredShellPath: () => configLoader.getConfig().execution.shellPath,
  });

  const config = configLoader.getConfig();

  // Create dock state manager with follow enabled by default
  const dockState = new DockStateManager(config.follow.enabledByDefault);

  const { update: updateWidget } = setupProcessesHooks(
    pi,
    manager,
    config,
    dockState,
  );
  setupProcessesCommands(pi, manager, dockState);
  setupProcessesTools(pi, manager);
  registerProcessesSettings(pi, () => {
    updateWidget();
  });
}
