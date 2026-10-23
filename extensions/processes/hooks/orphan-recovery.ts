/**
 * Orphan recovery hook.
 *
 * On `session_start`, kill process groups left behind by pi sessions that
 * died without running the graceful `session_shutdown` cleanup (SIGKILL,
 * OOM kill). The manager verifies each persisted record (boot ID + `/proc`
 * starttime) before signaling, so concurrent live sessions and reused PIDs
 * are never touched.
 *
 * Recovery runs for every start reason: `reload`/`new`/`fork` sessions share
 * this pi host process (whose own records were already cleaned up at
 * `session_shutdown`), while `startup`/`resume` sessions are new hosts whose
 * predecessors may have died abnormally.
 */

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
