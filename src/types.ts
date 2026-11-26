import {
  bool,
  int,
  nullable,
  num,
  obj,
  oneOf,
  type Static,
  str,
} from "@earendil-works/pi-schema";

export const PROCESS_STATUSES = [
  "running",
  "terminating",
  "terminate_timeout",
  "exited",
  "killed",
] as const;

export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const LIVE_STATUSES: ReadonlySet<ProcessStatus> = new Set([
  "running",
  "terminating",
  "terminate_timeout",
]);

export const PROCESS_END_REASONS = [
  "exit",
  "signal",
  "spawn_error",
  "missing_pid",
  "kill_timeout",
  "lost",
] as const;

export type ProcessEndReason = (typeof PROCESS_END_REASONS)[number];

export const ProcessSignalInfoSchema = obj({
  name: str(),
  number: nullable(int()),
  description: str(),
});

export type ProcessSignalInfo = Static<typeof ProcessSignalInfoSchema>;

export const processInfoProperties = {
  id: str(),
  name: str(),
  pid: int(), // On Unix, this is also the PGID (process group leader)
  command: str(),
  cwd: str(),
  startTime: num(),
  endTime: nullable(num()),
  status: oneOf(PROCESS_STATUSES),
  exitCode: nullable(int()),
  success: nullable(bool()), // null if running, true if exit code 0, false otherwise
  stdoutFile: str(),
  stderrFile: str(),
  endReason: nullable(oneOf(PROCESS_END_REASONS)),
  signal: nullable(ProcessSignalInfoSchema),
  errorMessage: nullable(str()),
} as const;

export const ProcessInfoSchema = obj(processInfoProperties);

export type ProcessInfo = Static<typeof ProcessInfoSchema>;

export type ProcessRegistryChangeReason = "cleared" | "updated";

export type ManagerEvent =
  | { type: "process_started"; info: ProcessInfo }
  | { type: "process_ended"; info: ProcessInfo }
  | {
      type: "process_output_changed";
      id: string;
      appendedText?: Array<{ type: "stdout" | "stderr"; text: string }>;
      droppedLines?: number;
    }
  | { type: "processes_changed"; reason: ProcessRegistryChangeReason };

/** Options for adopting an externally spawned child process. */
export interface AdoptProcessOptions {
  /** Pre-handover stdout; prepended to the stdout log, clamped to MAX_TAIL_READ_BYTES. */
  initialStdout?: Buffer;
  /** Pre-handover stderr; prepended to the stderr log, clamped to MAX_TAIL_READ_BYTES. */
  initialStderr?: Buffer;
  /** When the command actually started (epoch ms). Defaults to adoption time. */
  startTime?: number;
}

export const KILL_FAILURE_REASONS = ["not_found", "timeout", "error"] as const;

export type KillFailureReason = (typeof KILL_FAILURE_REASONS)[number];

export type KillResult =
  | { ok: true; info: ProcessInfo }
  | { ok: false; info: ProcessInfo; reason: KillFailureReason };

export type WriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "process_exited" | "stdin_closed" | "write_error";
    };
