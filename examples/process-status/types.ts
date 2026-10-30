/**
 * The subset of pi-processes' `ProcessInfo` this example reads. Kept local so
 * the folder can be copied into `~/.pi/agent/extensions/` without importing
 * the pi-processes sources.
 */
export interface ManagedProcess {
  id: string;
  name: string;
  command: string;
  startTime: number;
  endTime: number | null;
  status: "running" | "terminating" | "terminate_timeout" | "exited" | "killed";
  exitCode: number | null;
  success: boolean | null;
  errorMessage: string | null;
}

export const LIVE_STATUSES: ReadonlySet<ManagedProcess["status"]> = new Set([
  "running",
  "terminating",
  "terminate_timeout",
] as const);
