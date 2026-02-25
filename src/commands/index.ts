/**
 * Process commands with /ps: prefix.
 *
 * /ps         - Open full panel to view and manage processes
 * /ps:focus   - Focus on a specific process (opens dock)
 * /ps:kill    - Kill a running process
 * /ps:clear   - Clear finished processes
 * /ps:logs    - Show log file paths
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessManager } from "../manager";
import type { DockStateManager } from "../state/dock-state";
import { registerPsClearCommand } from "./ps-clear-command";
import { registerPsCommand } from "./ps-command";
import { registerPsDockCommand } from "./ps-dock-command";
import { registerPsFocusCommand } from "./ps-focus-command";
import { registerPsKillCommand } from "./ps-kill-command";
import { registerPsLogsCommand } from "./ps-logs-command";

export function setupProcessesCommands(
  pi: ExtensionAPI,
  manager: ProcessManager,
  dockState: DockStateManager,
): void {
  registerPsCommand(pi, manager, dockState);
  registerPsFocusCommand(pi, manager, dockState);
  registerPsLogsCommand(pi, manager, dockState);
  registerPsKillCommand(pi, manager, dockState);
  registerPsClearCommand(pi, manager);
  registerPsDockCommand(pi, dockState);
}
