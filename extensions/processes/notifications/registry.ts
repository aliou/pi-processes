import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

import { LINE_MATCH_MODES } from "../../../src/utils/match-line";
import { PROCESS_PROTOCOL_ATTENTIONS } from "../../shared/protocol";
import {
  MAX_LOG_MATCH_PATTERN_LENGTH,
  MAX_LOG_MATCHERS_PER_PROCESS,
} from "./log-matchers";

export const LOG_MATCH_STREAMS = ["stdout", "stderr", "both"] as const;

export const LogMatcherConfigSchema = Type.Object({
  pattern: Type.String({
    maxLength: MAX_LOG_MATCH_PATTERN_LENGTH,
    description:
      "Log pattern to match. Limited to 500 characters. Literal by default; regex only when mode is regex.",
  }),
  mode: Type.Optional(
    StringEnum(LINE_MATCH_MODES, {
      description: "Pattern matching mode. Defaults to literal.",
    }),
  ),
  stream: Type.Optional(
    StringEnum(LOG_MATCH_STREAMS, {
      description: "Output stream to inspect. Defaults to both.",
    }),
  ),
  repeat: Type.Optional(
    Type.Boolean({
      description:
        "Whether this matcher can notify more than once. Defaults to false.",
    }),
  ),
  on: Type.Optional(
    StringEnum(PROCESS_PROTOCOL_ATTENTIONS, {
      description: "Agent attention for this log match. Defaults to turn.",
    }),
  ),
});

export type LogMatcherConfig = Static<typeof LogMatcherConfigSchema>;

export const NotifyConfigSchema = Type.Object({
  onSuccess: Type.Optional(
    StringEnum(PROCESS_PROTOCOL_ATTENTIONS, {
      description: "Attention on clean exit. Defaults to turn.",
    }),
  ),
  onFailure: Type.Optional(
    StringEnum(PROCESS_PROTOCOL_ATTENTIONS, {
      description: "Attention on failure or crash. Defaults to turn.",
    }),
  ),
  onKilled: Type.Optional(
    StringEnum(PROCESS_PROTOCOL_ATTENTIONS, {
      description: "Attention on external kill. Defaults to context.",
    }),
  ),
  logMatches: Type.Optional(
    Type.Array(LogMatcherConfigSchema, {
      maxItems: MAX_LOG_MATCHERS_PER_PROCESS,
      description:
        "Log match notifications. Supports at most 20 matchers, with each pattern limited to 500 characters.",
    }),
  ),
});

export type NotifyConfig = Static<typeof NotifyConfigSchema>;

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
  mode?: LogMatcherConfig["mode"];
  stream?: LogMatcherConfig["stream"];
  repeat?: LogMatcherConfig["repeat"];
  on?: LogMatcherConfig["on"];
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
