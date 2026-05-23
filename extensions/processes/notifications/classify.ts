import type { ProcessInfo } from "../../../src/types";
import type { ProcessNotificationKind } from "./types";

export function classifyProcessEnd(info: ProcessInfo): ProcessNotificationKind {
  if (info.status === "terminate_timeout") return "timeout";
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
