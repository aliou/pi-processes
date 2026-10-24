import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProcessManager } from "../../../src/manager";
import { sanitizeForDisplay } from "../../shared/display-text";

export function registerOrphanRecoveryHook(
  pi: ExtensionAPI,
  manager: ProcessManager,
): void {
  pi.on("session_start", (_event, ctx) => {
    const report = manager.reapOrphanedProcesses();
    if (report.killed.length === 0) return;
    if (!ctx.hasUI) return;

    const lines = report.killed.map(
      (orphan) =>
        `- ${sanitizeForDisplay(orphan.name)} (pid ${orphan.pid}): ${sanitizeForDisplay(orphan.command)}`,
    );
    ctx.ui.notify(
      `[processes] Killed ${report.killed.length} orphaned process group${
        report.killed.length === 1 ? "" : "s"
      } left by a pi session that exited without cleanup:\n${lines.join("\n")}`,
      "warning",
    );
  });
}
