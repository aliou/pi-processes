import { LIVE_STATUSES, type ManagerEvent } from "../types";
import {
  type LogMatcherSpec,
  type ProcessListEntry,
  type ProcessWakeConditions,
  type ProcessWakeConfig,
  type ProcessWakeWatch,
  resolveWakeAttention,
  type WatchMeta,
  type WatchRemoveSpec,
  type WatchState,
  type WatchUpdateResult,
} from "../wake";
import {
  type CompiledLogMatcher,
  compileLogMatchers,
  evaluateLogMatchers,
  MAX_LOG_MATCHERS_PER_PROCESS,
} from "./log-matchers";
import type { ProcessRegistry } from "./process-registry";

export interface ProcessWakeDeps {
  emit: (event: ManagerEvent) => void;
  registry: ProcessRegistry;
}

interface ProcessMatcherState {
  matchers: CompiledLogMatcher[];
  revision: number;
  generation: number;
}

export class ProcessWakeController {
  private emit: ProcessWakeDeps["emit"];
  private registry: ProcessRegistry;

  private configs = new Map<string, ProcessWakeConfig>();
  private intentionalStops = new Set<string>();
  private watchMeta = new Map<string, WatchMeta>();
  private matcherStates = new Map<string, ProcessMatcherState>();

  constructor(deps: ProcessWakeDeps) {
    this.emit = deps.emit;
    this.registry = deps.registry;
  }

  registerWakeConfig(processId: string, config: ProcessWakeConfig): void {
    this.configs.set(processId, config);
    this.watchMeta.set(processId, { revision: 0, generation: 0 });
  }

  clearWakeConfig(processId: string): void {
    this.configs.delete(processId);
    this.intentionalStops.delete(processId);
    this.watchMeta.delete(processId);
    this.matcherStates.delete(processId);
  }

  getWakeConfig(processId: string): ProcessWakeConfig | null {
    return this.configs.get(processId) ?? null;
  }

  markIntentionalStop(processId: string): void {
    this.intentionalStops.add(processId);
  }

  consumeIntentionalStop(processId: string): boolean {
    return this.intentionalStops.delete(processId);
  }

  getWatchState(processId: string): WatchState | null {
    if (!this.configs.has(processId)) return null;
    const meta = this.watchMeta.get(processId) ?? {
      revision: 0,
      generation: 0,
    };
    return {
      logMatches: this.currentMatches(processId),
      revision: meta.revision,
      generation: meta.generation,
    };
  }

  appendWatches(
    processId: string,
    items: LogMatcherSpec[],
  ): WatchUpdateResult | null {
    if (!this.configs.has(processId)) return null;
    const existing = this.currentMatches(processId);
    const merged = [...existing, ...items];
    if (merged.length > MAX_LOG_MATCHERS_PER_PROCESS) {
      throw new Error(
        `process update watches would exceed maximum of ${MAX_LOG_MATCHERS_PER_PROCESS} matchers`,
      );
    }
    this.setMatches(processId, merged);
    const meta = this.bumpRevision(processId, false);
    return {
      logMatches: merged,
      revision: meta.revision,
      generation: meta.generation,
    };
  }

  replaceWatches(
    processId: string,
    items: LogMatcherSpec[],
  ): WatchUpdateResult | null {
    if (!this.configs.has(processId)) return null;
    if (items.length > MAX_LOG_MATCHERS_PER_PROCESS) {
      throw new Error(
        `process update watches would exceed maximum of ${MAX_LOG_MATCHERS_PER_PROCESS} matchers`,
      );
    }
    this.setMatches(processId, [...items]);
    const meta = this.bumpRevision(processId, true);
    return {
      logMatches: [...items],
      revision: meta.revision,
      generation: meta.generation,
    };
  }

  removeWatches(
    processId: string,
    specs: WatchRemoveSpec[],
  ): WatchUpdateResult | null {
    if (!this.configs.has(processId)) return null;
    const existing = this.currentMatches(processId);
    const filtered = existing.filter(
      (matcher, index) => !matchesRemoveSpec(matcher, index, specs),
    );
    this.setMatches(processId, filtered);
    const meta = this.bumpRevision(processId, false);
    return {
      logMatches: filtered,
      revision: meta.revision,
      generation: meta.generation,
    };
  }

  clearWatches(processId: string): WatchUpdateResult | null {
    if (!this.configs.has(processId)) return null;
    this.setMatches(processId, []);
    const meta = this.bumpRevision(processId, true);
    return {
      logMatches: [],
      revision: meta.revision,
      generation: meta.generation,
    };
  }

  getWakeConditions(processId: string): ProcessWakeConditions | null {
    const record = this.registry.getRecord(processId);
    if (!record || !LIVE_STATUSES.has(record.status)) return null;
    return this.buildWakeConditions(processId);
  }

  listWithWake(): ProcessListEntry[] {
    return this.registry
      .list()
      .map((process) =>
        LIVE_STATUSES.has(process.status)
          ? { ...process, wake: this.buildWakeConditions(process.id) }
          : process,
      );
  }

  handleOutputChanged(
    event: ManagerEvent & { type: "process_output_changed" },
  ): void {
    if (!event.appendedText || event.appendedText.length === 0) return;

    const watchState = this.getWatchState(event.id);
    if (!watchState) return;

    const state = this.syncMatcherState(event.id, watchState);
    if (!state) return;

    const matchTime = performance.now();
    const matches = evaluateLogMatchers(
      state.matchers,
      event.appendedText,
      matchTime,
    );

    if (matches.length === 0) return;

    this.emit({ type: "process_watch_matched", id: event.id, matches });
  }

  handleProcessEnded(processId: string): void {
    this.clearWakeConfig(processId);
  }

  clear(): void {
    this.configs.clear();
    this.intentionalStops.clear();
    this.watchMeta.clear();
    this.matcherStates.clear();
  }

  private buildWakeConditions(processId: string): ProcessWakeConditions {
    const config = this.configs.get(processId) ?? null;
    const watchState = this.getWatchState(processId);

    return {
      exitAttention: {
        success: resolveWakeAttention("onSuccess", config),
        failure: resolveWakeAttention("onFailure", config),
        killed: resolveWakeAttention("onKilled", config),
      },
      watches: watchState ? this.buildWatches(processId, watchState) : [],
    };
  }

  private buildWatches(
    processId: string,
    watchState: WatchState,
  ): ProcessWakeWatch[] {
    const state = this.syncMatcherState(processId, watchState);
    if (!state) return [];

    const firedByIndex = new Map<number, boolean>();
    for (const matcher of state.matchers) {
      firedByIndex.set(matcher.matcherIndex, matcher.fired);
    }

    return watchState.logMatches.map((watch, index) => ({
      pattern: watch.pattern,
      mode: watch.mode ?? "literal",
      stream: watch.stream ?? "both",
      repeat: watch.repeat ?? false,
      on: watch.on ?? "turn",
      fired: firedByIndex.get(index) ?? false,
    }));
  }

  private currentMatches(processId: string): LogMatcherSpec[] {
    const config = this.configs.get(processId);
    return config?.logMatches?.map((m) => ({ ...m })) ?? [];
  }

  private setMatches(processId: string, matches: LogMatcherSpec[]): void {
    const config = this.configs.get(processId);
    if (config) {
      config.logMatches = matches;
    }
  }

  private bumpRevision(processId: string, bumpGeneration: boolean): WatchMeta {
    const meta = this.watchMeta.get(processId) ?? {
      revision: 0,
      generation: 0,
    };
    meta.revision++;
    if (bumpGeneration) {
      meta.generation++;
    }
    this.watchMeta.set(processId, meta);
    return meta;
  }

  private syncMatcherState(
    processId: string,
    watchState: WatchState,
  ): ProcessMatcherState | null {
    const existing = this.matcherStates.get(processId);

    if (!existing) {
      const matchers = compileLogMatchers({
        logMatches: watchState.logMatches,
      });
      if (matchers.length === 0) return null;
      const state: ProcessMatcherState = {
        matchers,
        revision: watchState.revision,
        generation: watchState.generation,
      };
      this.matcherStates.set(processId, state);
      return state;
    }

    if (existing.revision === watchState.revision) return existing;

    const next = compileLogMatchers({ logMatches: watchState.logMatches });

    if (existing.generation === watchState.generation) {
      preserveMatcherRuntimeState(existing.matchers, next);
    }

    if (next.length === 0) {
      this.matcherStates.delete(processId);
      return null;
    }

    const state: ProcessMatcherState = {
      matchers: next,
      revision: watchState.revision,
      generation: watchState.generation,
    };
    this.matcherStates.set(processId, state);
    return state;
  }
}

function preserveMatcherRuntimeState(
  prev: CompiledLogMatcher[],
  next: CompiledLogMatcher[],
): void {
  const byKey = new Map<string, CompiledLogMatcher[]>();
  for (const m of prev) {
    const key = matcherIdentityKey(m);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(m);
    } else {
      byKey.set(key, [m]);
    }
  }

  for (const m of next) {
    const key = matcherIdentityKey(m);
    const bucket = byKey.get(key);
    if (!bucket || bucket.length === 0) continue;
    const donor = bucket.shift();
    if (!donor) continue;
    m.fired = donor.fired;
    m.lastMatchTime = donor.lastMatchTime;
  }
}

function matcherIdentityKey(m: {
  pattern: string;
  mode: string;
  stream: string;
  repeat: boolean;
  on: string;
}): string {
  return JSON.stringify([m.pattern, m.mode, m.stream, m.repeat, m.on]);
}

function matchesRemoveSpec(
  matcher: LogMatcherSpec,
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
