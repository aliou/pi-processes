import type { ChildProcess } from "node:child_process";

import type { KillResult, ProcessInfo } from "../types";

// UI emits, core handles then calls reply.

export interface CommandKillPayload {
  id: string;
  signal?: NodeJS.Signals;
  timeoutMs?: number;
  reply: (result: KillResult) => void;
}

export interface CommandClearPayload {
  reply: (cleared: number) => void;
}

// UI emits; the dock extension (if loaded) handles it by pinning the process
// to the dock. Pass `id: null` to unpin. If the dock extension is not
// registered, no listener replies.
export interface CommandPinPayload {
  id: string | null;
  reply: (result: CommandPinResult) => void;
}

export type CommandPinResult = { ok: true } | { ok: false; error: string };

// Another extension emits this to hand an already-running child process over
// to the manager. The child must have been spawned in a detached process
// group (`detached: true`) with piped stdio — the same shape the manager's
// own spawns use — so group kill and liveness polling work on it. Payloads
// cross the event bus by reference, so the live ChildProcess handle arrives
// intact. If the processes extension is not loaded, no listener replies.
export interface CommandAdoptPayload {
  name: string;
  command: string;
  cwd: string;
  child: ChildProcess;
  /** Output captured before handover; prepended to the process logs. */
  initialOutput?: Buffer;
  /** When the command actually started (epoch ms). */
  startTime?: number;
  reply: (result: CommandAdoptResult) => void;
}

export type CommandAdoptResult =
  | { ok: true; info: ProcessInfo }
  | { ok: false; error: string };
