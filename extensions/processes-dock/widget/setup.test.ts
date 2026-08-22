import type {
  EventBus,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import { createEventBus } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import type { ProcessProtocolConfig } from "../../shared/protocol";
import { CHANNELS } from "../../shared/protocol";
import { setupDockWidgets } from "./setup";

// Regression: dock auto-close after short-lived processes (#86).

function makeProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "quick",
    pid: 123,
    command: "echo hello",
    cwd: "/repo",
    startTime: 1000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: null,
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

function defaultConfig(): ProcessProtocolConfig {
  return {
    execution: { shellPath: undefined },
    interception: { blockBackgroundCommands: false },
    processList: { maxPreviewLines: 1, maxVisibleProcesses: 8 },
    output: {
      defaultTailLines: 50,
      maxOutputLines: 1000,
      maxOutputBytes: 100_000,
    },
    follow: { enabledByDefault: true, autoHideOnFinish: true },
    widget: {
      showStatusWidget: false,
      dockDefaultState: "collapsed",
      dockHeight: 10,
    },
  };
}

interface Harness {
  widgetState: Map<string, "visible" | "hidden">;
  emitStarted: (info: ProcessInfo) => void;
  emitEnded: (info: ProcessInfo) => void;
  dispose: () => void;
}

function createHarness(): Harness {
  const events: EventBus = createEventBus();
  const widgetState = new Map<string, "visible" | "hidden">();

  let processList: ProcessInfo[] = [];
  const config = defaultConfig();

  const ui: ExtensionUIContext = {
    setWidget: ((key: string, content: unknown, _options?: unknown) => {
      widgetState.set(key, content === undefined ? "hidden" : "visible");
    }) as never,
  } as unknown as ExtensionUIContext;

  const ctx: ExtensionContext = {
    hasUI: true,
    ui,
  } as unknown as ExtensionContext;

  // Register the core extension's request-reply handlers so the dock's
  // requestProcessList / requestConfig / requestCombinedOutput calls resolve.
  events.on(CHANNELS.REQUEST_LIST, (payload) => {
    (payload as { reply: (r: ProcessInfo[]) => void }).reply(
      processList.slice(),
    );
  });
  events.on(CHANNELS.REQUEST_GET, (payload) => {
    const p = payload as { id: string; reply: (r: ProcessInfo | null) => void };
    p.reply(processList.find((x) => x.id === p.id) ?? null);
  });
  events.on(CHANNELS.REQUEST_COMBINED_OUTPUT, (payload) => {
    const p = payload as {
      id: string;
      reply: (r: { type: "stdout" | "stderr"; text: string }[]) => void;
    };
    p.reply([]);
  });
  events.on(CHANNELS.REQUEST_CONFIG, (payload) => {
    (payload as { reply: (c: ProcessProtocolConfig) => void }).reply(config);
  });

  const controller = setupDockWidgets(ctx, events);

  return {
    widgetState,
    emitStarted: (info: ProcessInfo) => {
      processList = [info];
      events.emit(CHANNELS.STARTED, info);
      events.emit(CHANNELS.CHANGED, { reason: "started" });
    },
    emitEnded: (info: ProcessInfo) => {
      processList = [info];
      events.emit(CHANNELS.ENDED, info);
      events.emit(CHANNELS.CHANGED, { reason: "ended" });
    },
    dispose: () => controller?.dispose(),
  };
}

const DOCK_KEY = "processes-dock";

function dockIsVisible(h: Harness): boolean {
  return h.widgetState.get(DOCK_KEY) === "visible";
}

describe("dock auto-close", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-closes after a long-lived process (>125ms throttle window)", () => {
    const h = createHarness();
    try {
      h.emitStarted(makeProcess({ status: "running" }));

      vi.advanceTimersByTime(130);

      h.emitEnded(
        makeProcess({
          status: "exited",
          endTime: 2000,
          exitCode: 0,
          success: true,
        }),
      );

      vi.advanceTimersByTime(130);

      expect(dockIsVisible(h)).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("auto-closes after a short-lived process (<125ms throttle window)", () => {
    const h = createHarness();
    try {
      h.emitStarted(makeProcess({ status: "running" }));

      h.emitEnded(
        makeProcess({
          status: "exited",
          endTime: 1001,
          exitCode: 0,
          success: true,
        }),
      );

      vi.advanceTimersByTime(130);

      expect(dockIsVisible(h)).toBe(false);
    } finally {
      h.dispose();
    }
  });
});
