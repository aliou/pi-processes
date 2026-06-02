import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ResolvedProcessesConfig } from "../config";
import type { LogWatchStream, ManagerEvent } from "../constants";
import type { ProcessManager } from "../manager";
import { setupProcessWatchHook } from "./process-watch";

interface SentMessage {
  // biome-ignore lint/suspicious/noExplicitAny: test capture
  message: any;
  // biome-ignore lint/suspicious/noExplicitAny: test capture
  options: any;
}

function makeHarness(watchConfig: {
  maxWakesPerWatch: number;
  dedupeConsecutive: boolean;
}) {
  const listeners: Array<(e: ManagerEvent) => void> = [];
  const manager = {
    onEvent: (l: (e: ManagerEvent) => void) => {
      listeners.push(l);
      return () => {};
    },
  } as unknown as ProcessManager;

  const sent: SentMessage[] = [];
  const pi = {
    sendMessage: (message: unknown, options: unknown) => {
      sent.push({ message, options });
    },
  } as unknown as ExtensionAPI;

  const config = { watch: watchConfig } as ResolvedProcessesConfig;
  setupProcessWatchHook(pi, manager, config);

  const emit = (e: ManagerEvent) => {
    for (const l of listeners) l(e);
  };
  return { emit, sent };
}

function matchEvent(opts: {
  line?: string;
  maxWakes?: number;
  dedupe?: boolean;
  repeat?: boolean;
  processId?: string;
}): ManagerEvent {
  return {
    type: "process_watch_matched",
    match: {
      processId: opts.processId ?? "p1",
      processName: "test",
      processCommand: "cmd",
      source: "stdout",
      line: opts.line ?? "ERROR boom",
      watch: {
        index: 0,
        pattern: "ERROR",
        stream: "both" as LogWatchStream,
        repeat: opts.repeat ?? true,
        maxWakes: opts.maxWakes,
        dedupe: opts.dedupe,
      },
    },
  };
}

function endEvent(processId = "p1"): ManagerEvent {
  return {
    type: "process_ended",
    info: { id: processId },
  } as unknown as ManagerEvent;
}

describe("process-watch wake budget", () => {
  it("emits up to the configured budget then one budget notice", () => {
    const { emit, sent } = makeHarness({
      maxWakesPerWatch: 3,
      dedupeConsecutive: false,
    });

    for (let i = 0; i < 5; i++) {
      emit(matchEvent({ line: `ERROR ${i}` }));
    }

    // 3 watch wakes + 1 budget-reached notice = 4 sends; 5th match suppressed.
    expect(sent).toHaveLength(4);
    expect(
      sent
        .slice(0, 3)
        .every((s) => s.message.details?.kind === "watch_matched"),
    ).toBe(true);

    const notice = sent[3];
    expect(notice.message.details).toBeUndefined();
    expect(notice.message.content).toContain("wake budget");
    expect(notice.options.triggerTurn).toBe(false);
  });

  it("treats maxWakes: 0 (per-watch override) as unlimited", () => {
    const { emit, sent } = makeHarness({
      maxWakesPerWatch: 2,
      dedupeConsecutive: false,
    });

    for (let i = 0; i < 5; i++) {
      emit(matchEvent({ line: `ERROR ${i}`, maxWakes: 0 }));
    }

    expect(sent).toHaveLength(5);
    expect(sent.every((s) => s.message.details?.kind === "watch_matched")).toBe(
      true,
    );
  });

  it("resets the budget when the process ends", () => {
    const { emit, sent } = makeHarness({
      maxWakesPerWatch: 2,
      dedupeConsecutive: false,
    });

    // 2 wakes + 1 notice
    emit(matchEvent({ line: "ERROR a" }));
    emit(matchEvent({ line: "ERROR b" }));
    emit(matchEvent({ line: "ERROR c" }));
    expect(sent).toHaveLength(3);

    emit(endEvent("p1"));

    // After reset, a fresh match wakes again.
    emit(matchEvent({ line: "ERROR d" }));
    expect(sent).toHaveLength(4);
    expect(sent[3].message.details?.kind).toBe("watch_matched");
  });
});

describe("process-watch dedupe", () => {
  it("suppresses consecutive identical matched lines when dedupe is on", () => {
    const { emit, sent } = makeHarness({
      maxWakesPerWatch: 0,
      dedupeConsecutive: true,
    });

    emit(matchEvent({ line: "ERROR same" }));
    emit(matchEvent({ line: "ERROR same" }));
    emit(matchEvent({ line: "ERROR same" }));
    emit(matchEvent({ line: "ERROR other" }));
    emit(matchEvent({ line: "ERROR other" }));

    // first "same" + first "other" = 2 sends
    expect(sent).toHaveLength(2);
    expect(sent[0].message.details.line).toBe("ERROR same");
    expect(sent[1].message.details.line).toBe("ERROR other");
  });

  it("does not dedupe by default", () => {
    const { emit, sent } = makeHarness({
      maxWakesPerWatch: 0,
      dedupeConsecutive: false,
    });

    emit(matchEvent({ line: "ERROR same" }));
    emit(matchEvent({ line: "ERROR same" }));

    expect(sent).toHaveLength(2);
  });
});

describe("process-watch delivery", () => {
  it("delivers output-pattern wakes as steer", () => {
    const { emit, sent } = makeHarness({
      maxWakesPerWatch: 0,
      dedupeConsecutive: false,
    });

    emit(matchEvent({ line: "ERROR x" }));

    expect(sent[0].options.deliverAs).toBe("steer");
  });
});
