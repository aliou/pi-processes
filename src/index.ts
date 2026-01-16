import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setupProcessesCommands } from "./commands";
import { setupProcessesHooks } from "./hooks";
import { ProcessManager } from "./manager";
import { setupProcessesTools } from "./tools";

export default function (pi: ExtensionAPI) {
  const manager = new ProcessManager();

  const statusUpdater = setupProcessesHooks(pi, manager);

  setupProcessesTools(pi, manager, statusUpdater);
  setupProcessesCommands(pi, manager);
}
