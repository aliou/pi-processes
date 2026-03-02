/**
 * Process commands with /ps: prefix.
 *
 * /ps                         - View and manage all background processes
 * /ps:logs [id]               - Open log viewer overlay (search, scroll, stream filter)
 * /ps:pin [id]                - Pin the dock to a specific process
 * /ps:kill [id]               - Kill a running process
 * /ps:clear                   - Remove all finished processes from the list
 * /ps:dock [show|hide|toggle] - Control dock visibility
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { DockActions } from "../hooks/widget";
import type { ProcessManager } from "../manager";
import { registerPsClearCommand } from "./ps-clear-command";
import { registerPsCommand } from "./ps-command";
import { registerPsDockCommand } from "./ps-dock-command";
import { registerPsKillCommand } from "./ps-kill-command";
import { registerPsLogsCommand } from "./ps-logs-command";
import { registerPsPinCommand } from "./ps-pin-command";

export function setupProcessesCommands(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockActions: DockActions,
): void {
  registerPsCommand(pi, manager, dockActions);
  registerPsPinCommand(pi, manager, dockActions);
  registerPsLogsCommand(pi, manager);
  registerPsKillCommand(pi, manager, dockActions);
  registerPsClearCommand(pi, manager);
  registerPsDockCommand(pi, dockActions);
}
