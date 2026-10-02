import { type Static, type TSchema, type TUnsafe, Type } from "typebox";

function StringEnum<const T extends readonly string[]>(
  values: T,
): TUnsafe<T[number]> {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
  } as TSchema);
}

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

export const ProcessSignalInfoSchema = Type.Object({
  name: Type.String(),
  number: Type.Union([Type.Integer(), Type.Null()]),
  description: Type.String(),
});

export type ProcessSignalInfo = Static<typeof ProcessSignalInfoSchema>;

export const ProcessInfoSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  pid: Type.Integer(), // On Unix, this is also the PGID (process group leader)
  command: Type.String(),
  cwd: Type.String(),
  startTime: Type.Number(),
  endTime: Type.Union([Type.Number(), Type.Null()]),
  status: StringEnum(PROCESS_STATUSES),
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
  success: Type.Union([Type.Boolean(), Type.Null()]), // null if running, true if exit code 0, false otherwise
  stdoutFile: Type.String(),
  stderrFile: Type.String(),
  endReason: Type.Union([StringEnum(PROCESS_END_REASONS), Type.Null()]),
  signal: Type.Union([ProcessSignalInfoSchema, Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
});

export type ProcessInfo = Static<typeof ProcessInfoSchema>;

export type ManagerEvent =
  | { type: "process_started"; info: ProcessInfo }
  | { type: "process_ended"; info: ProcessInfo }
  | {
      type: "process_output_changed";
      id: string;
      appendedText?: Array<{ type: "stdout" | "stderr"; text: string }>;
      droppedLines?: number;
    }
  | { type: "processes_changed" };

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
