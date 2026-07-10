import type { ProcessInfo } from "../../../src/types";
import type { ProcessNotificationKind } from "./types";

/**
 * Classify a process end into a notification kind.
 *
 * A kill that times out is never classified here: `terminate_timeout` never
 * reaches `process_ended` (the kill path sets `endTime` and transitions without
 * emitting, and the close handler bails on the `endTime` guard). The stop tool
 * carries the timeout via `KillResult.reason: "timeout"` instead.
 */
export function classifyProcessEnd(info: ProcessInfo): ProcessNotificationKind {
  if (info.status === "killed") return "killed";
  if (info.success === true) return "success";

  if (
    info.endReason === "spawn_error" ||
    info.endReason === "missing_pid" ||
    info.endReason === "lost"
  ) {
    return "crash";
  }

  if (info.exitCode !== null && info.exitCode !== 0) return "crash";

  return "failure";
}
