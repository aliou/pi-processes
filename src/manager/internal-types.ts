import type { Writable } from "node:stream";

import type {
  ProcessEndReason,
  ProcessInfo,
  ProcessSignalInfo,
  ProcessStatus,
} from "../types";

export interface ProcessLogPaths {
  stdoutFile: string;
  stderrFile: string;
  combinedFile: string;
}

/**
 * Stable process metadata and lifecycle status.
 *
 * This is the part of a managed process that can be safely projected into the
 * public `ProcessInfo` API. It intentionally contains no Node handles, mutable
 * stream buffers, or manager bookkeeping fields.
 */
interface ProcessPublicState {
  id: string;
  name: string;
  pid: number;
  command: string;
  cwd: string;
  startTime: number;
  endTime: number | null;
  status: ProcessStatus;
  exitCode: number | null;
  success: boolean | null;
  stdoutFile: string;
  stderrFile: string;
  endReason: ProcessEndReason | null;
  signal: ProcessSignalInfo | null;
  errorMessage: string | null;
}

/**
 * Process handles and signal bookkeeping used by runtime control.
 *
 * Only `ProcessRuntimeController` should need these fields. They are not safe
 * to expose because they allow direct mutation/control outside manager methods.
 */
interface ProcessRuntimeState {
  stdin: Writable | null;
  stdinClosed: boolean;
  lastSignalSent: NodeJS.Signals | null;
}

/**
 * Internal log storage details.
 *
 * `stdoutFile` and `stderrFile` are public because agents/users can inspect
 * them. The combined log file is an implementation detail used by manager/UI
 * read APIs, so it stays internal.
 */
interface ProcessLogState {
  combinedFile: string;
}

/**
 * Output parser state for incomplete line chunks.
 *
 * Node streams can split a single logical line across multiple chunks. These
 * buffers let `ProcessOutput` emit only completed lines in events/logs.
 */
interface ProcessLineBufferState {
  stdoutPendingLine: Buffer;
  stderrPendingLine: Buffer;
  /** The line head was emitted; discard the tail through the next newline. */
  stdoutLineOverflowed: boolean;
  /** The line head was emitted; discard the tail through the next newline. */
  stderrLineOverflowed: boolean;
}

/**
 * Output lines accumulated since the last `process_output_changed` event.
 *
 * `ProcessOutput` drains this buffer when it emits an output event. This
 * gives extension code live lines without re-reading log files or polling.
 */
interface ProcessOutputEventBufferState {
  appendedLines: Array<{ type: "stdout" | "stderr"; text: string }>;
  droppedLineCount: number;
}

/**
 * Internal mutable record owned by `ProcessManager`.
 *
 * This is intentionally broader than public `ProcessInfo`: it combines public
 * lifecycle state with runtime handles, log implementation details, and output
 * parser buffers. Callers must receive `ProcessInfo` snapshots instead, created
 * by `formatProcess()` below.
 */
export interface ManagedProcessRecord
  extends ProcessPublicState,
    ProcessRuntimeState,
    ProcessLogState,
    ProcessLineBufferState,
    ProcessOutputEventBufferState {}

/**
 * Convert an internal mutable record into the public process snapshot.
 *
 * Keep this function explicit instead of using object spread so new internal
 * fields cannot accidentally leak into the public manager API.
 */
export function formatProcess(record: ManagedProcessRecord): ProcessInfo {
  return {
    id: record.id,
    name: record.name,
    pid: record.pid,
    command: record.command,
    cwd: record.cwd,
    startTime: record.startTime,
    endTime: record.endTime,
    status: record.status,
    exitCode: record.exitCode,
    success: record.success,
    stdoutFile: record.stdoutFile,
    stderrFile: record.stderrFile,
    endReason: record.endReason,
    signal: record.signal,
    errorMessage: record.errorMessage,
  };
}
