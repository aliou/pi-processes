import type { ProcessSignalInfo } from "../types";

const SIGNALS: Partial<
  Record<NodeJS.Signals, { number: number; description: string }>
> = {
  SIGINT: { number: 2, description: "interrupt" },
  SIGTERM: { number: 15, description: "termination request" },
  SIGKILL: { number: 9, description: "forced kill" },
  SIGHUP: { number: 1, description: "terminal hangup" },
  SIGQUIT: { number: 3, description: "quit" },
  SIGABRT: { number: 6, description: "abort" },
  SIGALRM: { number: 14, description: "alarm" },
};

export function formatSignalInfo(signal: NodeJS.Signals): ProcessSignalInfo {
  const known = SIGNALS[signal];
  return {
    name: signal,
    number: known?.number ?? null,
    description: known?.description ?? signal,
  };
}
