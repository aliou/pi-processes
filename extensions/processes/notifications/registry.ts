import { MAX_LOG_MATCHERS_PER_PROCESS } from "./log-matchers";
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

export interface WatchMeta {
  revision: number;
  generation: number;
}

export interface WatchState {
  logMatches: LogMatcherConfig[];
  revision: number;
  generation: number;
}

export interface WatchRemoveSpec {
  index?: number;
  pattern?: string;
  mode?: "literal" | "regex";
  stream?: "stdout" | "stderr" | "both";
  repeat?: boolean;
  on?: Attention;
}

export interface WatchUpdateResult {
  logMatches: LogMatcherConfig[];
  revision: number;
  generation: number;
}

export interface NotificationRegistry {
  register(processId: string, config: NotifyConfig): void;
  unregister(processId: string): void;
  get(processId: string): NotifyConfig | null;
  markIntentionalStop(processId: string): void;
  consumeIntentionalStop(processId: string): boolean;
  clear(): void;
  appendWatches(
    processId: string,
    items: LogMatcherConfig[],
  ): WatchUpdateResult | null;
  replaceWatches(
    processId: string,
    items: LogMatcherConfig[],
  ): WatchUpdateResult | null;
  removeWatches(
    processId: string,
    specs: WatchRemoveSpec[],
  ): WatchUpdateResult | null;
  clearWatches(processId: string): WatchUpdateResult | null;
  getWatchState(processId: string): WatchState | null;
}

export function createNotificationRegistry(): NotificationRegistry {
  const configs = new Map<string, NotifyConfig>();
  const intentionalStops = new Set<string>();
  const watchMeta = new Map<string, WatchMeta>();

  function currentMatches(processId: string): LogMatcherConfig[] {
    const config = configs.get(processId);
    return config?.logMatches?.map((m) => ({ ...m })) ?? [];
  }

  function setMatches(processId: string, matches: LogMatcherConfig[]): void {
    const config = configs.get(processId);
    if (config) {
      config.logMatches = matches;
    }
  }

  function bumpRevision(processId: string, bumpGeneration: boolean): WatchMeta {
    const meta = watchMeta.get(processId) ?? { revision: 0, generation: 0 };
    meta.revision++;
    if (bumpGeneration) {
      meta.generation++;
    }
    watchMeta.set(processId, meta);
    return meta;
  }

  return {
    register(processId: string, config: NotifyConfig): void {
      configs.set(processId, config);
      watchMeta.set(processId, { revision: 0, generation: 0 });
    },

    unregister(processId: string): void {
      configs.delete(processId);
      intentionalStops.delete(processId);
      watchMeta.delete(processId);
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
      watchMeta.clear();
    },

    appendWatches(
      processId: string,
      items: LogMatcherConfig[],
    ): WatchUpdateResult | null {
      if (!configs.has(processId)) return null;
      const existing = currentMatches(processId);
      const merged = [...existing, ...items];
      if (merged.length > MAX_LOG_MATCHERS_PER_PROCESS) {
        throw new Error(
          `process update watches would exceed maximum of ${MAX_LOG_MATCHERS_PER_PROCESS} matchers`,
        );
      }
      setMatches(processId, merged);
      const meta = bumpRevision(processId, false);
      return {
        logMatches: merged,
        revision: meta.revision,
        generation: meta.generation,
      };
    },

    replaceWatches(
      processId: string,
      items: LogMatcherConfig[],
    ): WatchUpdateResult | null {
      if (!configs.has(processId)) return null;
      if (items.length > MAX_LOG_MATCHERS_PER_PROCESS) {
        throw new Error(
          `process update watches would exceed maximum of ${MAX_LOG_MATCHERS_PER_PROCESS} matchers`,
        );
      }
      setMatches(processId, [...items]);
      const meta = bumpRevision(processId, true);
      return {
        logMatches: [...items],
        revision: meta.revision,
        generation: meta.generation,
      };
    },

    removeWatches(
      processId: string,
      specs: WatchRemoveSpec[],
    ): WatchUpdateResult | null {
      if (!configs.has(processId)) return null;
      const existing = currentMatches(processId);
      const filtered = existing.filter(
        (matcher, index) => !matchesRemoveSpec(matcher, index, specs),
      );
      setMatches(processId, filtered);
      const meta = bumpRevision(processId, false);
      return {
        logMatches: filtered,
        revision: meta.revision,
        generation: meta.generation,
      };
    },

    clearWatches(processId: string): WatchUpdateResult | null {
      if (!configs.has(processId)) return null;
      setMatches(processId, []);
      const meta = bumpRevision(processId, true);
      return {
        logMatches: [],
        revision: meta.revision,
        generation: meta.generation,
      };
    },

    getWatchState(processId: string): WatchState | null {
      if (!configs.has(processId)) return null;
      const meta = watchMeta.get(processId) ?? { revision: 0, generation: 0 };
      return {
        logMatches: currentMatches(processId),
        revision: meta.revision,
        generation: meta.generation,
      };
    },
  };
}

function matchesRemoveSpec(
  matcher: LogMatcherConfig,
  index: number,
  specs: WatchRemoveSpec[],
): boolean {
  return specs.some((spec) => {
    if (spec.index !== undefined) return spec.index === index;
    if (!spec.pattern) return false;
    if (matcher.pattern !== spec.pattern) return false;
    if (spec.mode !== undefined && (matcher.mode ?? "literal") !== spec.mode)
      return false;
    if (spec.stream !== undefined && (matcher.stream ?? "both") !== spec.stream)
      return false;
    if (spec.repeat !== undefined && (matcher.repeat ?? false) !== spec.repeat)
      return false;
    if (spec.on !== undefined && (matcher.on ?? "turn") !== spec.on)
      return false;
    return true;
  });
}
