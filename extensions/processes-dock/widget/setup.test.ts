import type {
  EventBus,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import { createEventBus } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import type {
  CommandPinResult,
  ProcessProtocolConfig,
} from "../../shared/protocol";
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
      showStatusWidget: true,
      dockDefaultState: "collapsed",
      dockHeight: 10,
    },
  };
}

interface Harness {
  widgetState: Map<string, "visible" | "hidden">;
  widgetContent: Map<string, unknown>;
  emitStarted: (info: ProcessInfo) => void;
  emitEnded: (info: ProcessInfo) => void;
  emitPin: (id: string | null) => CommandPinResult;
  dispose: () => void;
}

function createHarness(): Harness {
  const events: EventBus = createEventBus();
  const widgetState = new Map<string, "visible" | "hidden">();
  const widgetContent = new Map<string, unknown>();

  let processList: ProcessInfo[] = [];
  const config = defaultConfig();

  const ui: ExtensionUIContext = {
    setWidget: ((key: string, content: unknown, _options?: unknown) => {
      widgetState.set(key, content === undefined ? "hidden" : "visible");
      widgetContent.set(key, content);
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
  const upsertProcess = (info: ProcessInfo) => {
    processList = [
      ...processList.filter((process) => process.id !== info.id),
      info,
    ];
  };

  return {
    widgetState,
    widgetContent,
    emitStarted: (info: ProcessInfo) => {
      upsertProcess(info);
      events.emit(CHANNELS.STARTED, info);
      events.emit(CHANNELS.CHANGED, { reason: "started" });
    },
    emitEnded: (info: ProcessInfo) => {
      upsertProcess(info);
      events.emit(CHANNELS.ENDED, info);
      events.emit(CHANNELS.CHANGED, { reason: "ended" });
    },
    emitPin: (id: string | null) => {
      let result: CommandPinResult | undefined;
      events.emit(CHANNELS.COMMAND_PIN, {
        id,
        reply: (value: CommandPinResult) => {
          result = value;
        },
      });
      if (!result) throw new Error("COMMAND_PIN did not reply");
      return result;
    },
    dispose: () => controller?.dispose(),
  };
}

const DOCK_KEY = "processes-dock";
const STATUS_KEY = "processes-status";

function dockIsVisible(h: Harness): boolean {
  return h.widgetState.get(DOCK_KEY) === "visible";
}

function statusLine(h: Harness): string | null {
  const factory = h.widgetContent.get(STATUS_KEY) as
    | ((
        tui: unknown,
        theme: unknown,
      ) => { render: (width: number) => string[] })
    | undefined;
  if (!factory) return null;
  const theme = {
    fg: (color: string, text: string) => `{${color}:${text}}`,
    bg: (_color: string, text: string) => text,
  };
  return factory(null, theme).render(200)[0] ?? null;
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

  // Regression: overview unpin bypassed dock auto-close (#104).
  it("closes when an ended pinned process is unpinned from the overview", () => {
    const h = createHarness();
    try {
      h.emitStarted(makeProcess());
      vi.advanceTimersByTime(130);
      expect(h.emitPin("proc_1")).toEqual({ ok: true });

      h.emitEnded(
        makeProcess({
          status: "exited",
          endTime: 2000,
          exitCode: 0,
          success: true,
        }),
      );
      vi.advanceTimersByTime(130);
      expect(dockIsVisible(h)).toBe(true);

      expect(h.emitPin(null)).toEqual({ ok: true });

      expect(dockIsVisible(h)).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("stays expanded when a pinned process is unpinned while another is live", () => {
    const h = createHarness();
    try {
      h.emitStarted(makeProcess({ id: "proc_1", name: "api" }));
      h.emitStarted(
        makeProcess({ id: "proc_2", name: "worker", startTime: 2000 }),
      );
      vi.advanceTimersByTime(130);
      expect(h.emitPin("proc_1")).toEqual({ ok: true });

      h.emitEnded(
        makeProcess({
          id: "proc_1",
          name: "api",
          status: "exited",
          endTime: 3000,
          exitCode: 0,
          success: true,
        }),
      );
      vi.advanceTimersByTime(130);

      expect(h.emitPin(null)).toEqual({ ok: true });

      expect(dockIsVisible(h)).toBe(true);
    } finally {
      h.dispose();
    }
  });
});

describe("status widget pending terminal processes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a failed process visible until the next process starts, then folds it", () => {
    const h = createHarness();
    try {
      h.emitStarted(makeProcess({ id: "proc_1", name: "lint" }));
      h.emitEnded(
        makeProcess({
          id: "proc_1",
          name: "lint",
          status: "exited",
          endTime: 2000,
          exitCode: 7,
          success: false,
        }),
      );
      vi.advanceTimersByTime(130);
      expect(statusLine(h)).toContain("{error:lint}");

      h.emitStarted(
        makeProcess({ id: "proc_2", name: "dev", startTime: 3000 }),
      );
      vi.advanceTimersByTime(130);
      expect(statusLine(h)).toContain("{error:!}");
      expect(statusLine(h)).toContain("1 failed");
      expect(statusLine(h)).not.toContain("lint");
    } finally {
      h.dispose();
    }
  });

  it("keeps a killed process visible until the next process starts, then folds it", () => {
    const h = createHarness();
    try {
      h.emitStarted(makeProcess({ id: "proc_1", name: "server" }));
      h.emitEnded(
        makeProcess({
          id: "proc_1",
          name: "server",
          status: "killed",
          endTime: 2000,
          success: false,
        }),
      );
      vi.advanceTimersByTime(130);
      expect(statusLine(h)).toContain("server");

      h.emitStarted(
        makeProcess({ id: "proc_2", name: "dev", startTime: 3000 }),
      );
      vi.advanceTimersByTime(130);
      expect(statusLine(h)).toContain("{dim:■}");
      expect(statusLine(h)).toContain("1 killed");
      expect(statusLine(h)).not.toContain("server");
    } finally {
      h.dispose();
    }
  });

  it("folds a successful exit into the done summary immediately", () => {
    const h = createHarness();
    try {
      h.emitStarted(makeProcess({ id: "proc_1", name: "build" }));
      h.emitEnded(
        makeProcess({
          id: "proc_1",
          name: "build",
          status: "exited",
          endTime: 2000,
          exitCode: 0,
          success: true,
        }),
      );
      vi.advanceTimersByTime(130);
      expect(statusLine(h)).toContain("1 done");
      expect(statusLine(h)).not.toContain("build");
    } finally {
      h.dispose();
    }
  });
});
