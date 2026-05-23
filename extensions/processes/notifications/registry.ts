import type { Attention } from "./types";

export interface LogMatcherConfig {
  pattern: string;
  mode?: "literal" | "regex";
  stream?: "stdout" | "stderr" | "both";
  repeat?: boolean;
  on?: Attention;
}

export interface NotifyConfig {
  onSuccess?: Attention;
  onFailure?: Attention;
  onKilled?: Attention;
  logMatches?: LogMatcherConfig[];
}

export interface NotificationRegistry {
  register(processId: string, config: NotifyConfig): void;
  unregister(processId: string): void;
  get(processId: string): NotifyConfig | null;
  markIntentionalStop(processId: string): void;
  consumeIntentionalStop(processId: string): boolean;
  clear(): void;
}

export function createNotificationRegistry(): NotificationRegistry {
  const configs = new Map<string, NotifyConfig>();
  const intentionalStops = new Set<string>();

  return {
    register(processId: string, config: NotifyConfig): void {
      configs.set(processId, config);
    },

    unregister(processId: string): void {
      configs.delete(processId);
      intentionalStops.delete(processId);
    },

    get(processId: string): NotifyConfig | null {
      return configs.get(processId) ?? null;
    },

    markIntentionalStop(processId: string): void {
      intentionalStops.add(processId);
    },

    consumeIntentionalStop(processId: string): boolean {
      return intentionalStops.delete(processId);
    },

    clear(): void {
      configs.clear();
      intentionalStops.clear();
    },
  };
}
