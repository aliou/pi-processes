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
