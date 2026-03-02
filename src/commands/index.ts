/**
 * Process commands with /ps: prefix.
 *
 * /ps          - Open full panel to view and manage processes
 * /ps:list     - Alias for /ps
 * /ps:logs     - Open tabbed log viewer overlay for a process
 * /ps:focus    - Focus a process in the dock (opens dock, shows its logs)
 * /ps:kill     - Kill a running process
 * /ps:clear    - Clear finished processes
 * /ps:dock     - Toggle dock visibility (on/off/expanded)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { DockActions } from "../hooks/widget";
import type { ProcessManager } from "../manager";
import { registerPsClearCommand } from "./ps-clear-command";
import { registerPsCommand } from "./ps-command";
import { registerPsDockCommand } from "./ps-dock-command";
import { registerPsFocusCommand } from "./ps-focus-command";
import { registerPsKillCommand } from "./ps-kill-command";
import { registerPsListCommand } from "./ps-list-command";
import { registerPsLogsCommand } from "./ps-logs-command";

export function setupProcessesCommands(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockActions: DockActions,
): void {
  registerPsCommand(pi, manager, dockActions);
  registerPsListCommand(pi, manager, dockActions);
  registerPsFocusCommand(pi, manager, dockActions);
  registerPsLogsCommand(pi, manager);
  registerPsKillCommand(pi, manager, dockActions);
  registerPsClearCommand(pi, manager);
  registerPsDockCommand(pi, dockActions);
}
