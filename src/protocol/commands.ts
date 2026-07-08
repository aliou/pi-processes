import type { KillResult } from "../types";

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
