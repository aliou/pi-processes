import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../../../src/protocol";
import type { ProcessInfo } from "../../../src/types";
import type { ProcessLogLine } from "../logs-client";
import { LogOverlayComponent } from "./log-overlay-component";

const theme = {
  fg: (_c: string, t: string) => t,
  bg: (_c: string, t: string) => t,
  bold: (t: string) => t,
  italic: (t: string) => t,
  underline: (t: string) => t,
  inverse: (t: string) => t,
  strikethrough: (t: string) => t,
} as unknown as Theme;

const TAB = "\t";

function makeProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "dev",
    pid: 1,
    command: "pnpm dev",
    cwd: "/tmp",
    startTime: 1000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "",
    stderrFile: "",
    endReason: null,
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

/**
 * Minimal config surface exercised by the overlay. The remaining fields are
 * not read by LogOverlayComponent at runtime, so an `as never` cast is safe.
 */
function makeConfig() {
  return {
    output: { defaultTailLines: 100, maxOutputLines: 2000 },
    follow: { enabledByDefault: true, autoHideOnFinish: false },
    processList: { maxPreviewLines: 24, maxVisibleProcesses: 12 },
  } as never;
}

/**
 * EventBus fake that handles the three synchronous request/reply channels the
 * overlay uses (REQUEST_LIST, LOGS_SUBSCRIBE) plus the fire-and-forget
 * LOGS_UNSUBSCRIBE. Initial lines are looked up per process id so each tab
 * shows its own output, and a fresh subscription for an already-seen process
 * would return the same initial tail again (this is what caches must avoid
 * re-applying).
 */
function makeEvents(
  processes: ProcessInfo[],
  initialLines: Record<string, ProcessLogLine[]>,
) {
  return {
    on: vi.fn((_channel: string, _cb: (payload: never) => void) => () => {}),
    emit: vi.fn((channel: string, payload: never) => {
      const p = payload as { reply?: (v: unknown) => void; processId?: string };
      if (channel === CHANNELS.REQUEST_LIST) {
        p.reply?.(processes);
        return;
      }
      if (channel === CHANNELS.LOGS_SUBSCRIBE) {
        const lines = initialLines[p.processId ?? ""] ?? [];
        p.reply?.({ ok: true, initialLines: lines });
        return;
      }
      // LOGS_UNSUBSCRIBE and any other channels are fire-and-forget.
    }),
  };
}

function makeOverlay() {
  const proc1 = makeProcess({
    id: "proc_1",
    name: "dev",
    command: "pnpm dev",
    status: "running",
  });
  const proc2 = makeProcess({
    id: "proc_2",
    name: "tests",
    command: "pnpm test",
    status: "running",
  });
  const initialLines: Record<string, ProcessLogLine[]> = {
    // A single distinct line per process so we can detect duplication.
    proc_1: [{ type: "stdout", text: "proc-one-line" }],
    proc_2: [{ type: "stdout", text: "proc-two-line" }],
  };
  const events = makeEvents([proc1, proc2], initialLines);
  const tui = {
    requestRender: () => {},
    terminal: { rows: 40, columns: 120 },
  } as unknown as TUI;

  const overlay = new LogOverlayComponent({
    events: events as never,
    tui: tui as never,
    theme: theme as never,
    config: makeConfig(),
    onClose: () => {},
    initialProcessId: "proc_1",
  });
  return { overlay, width: 120 };
}

/**
 * The overlay's status footer is rendered inside the Panel above its bottom
 * border, so join all rendered lines and assert on the whole surface.
 */
function footer(overlay: LogOverlayComponent, width: number): string {
  return overlay.render(width).join("\n");
}

describe("LogOverlayComponent viewer cache", () => {
  it("preserves follow state across a tab round-trip", () => {
    const { overlay, width } = makeOverlay();

    // proc_1: follow defaults on.
    expect(footer(overlay, width)).toContain("following");

    // Turn follow off on proc_1.
    overlay.handleInput("f");
    expect(footer(overlay, width)).not.toContain("following");

    // Switch to proc_2: a fresh viewer is created with follow on by default.
    overlay.handleInput(TAB);
    expect(footer(overlay, width)).toContain("following");

    // Switch back to proc_1: the cached viewer is reused, so follow must
    // still be off (not reset to the default).
    overlay.handleInput(TAB);
    expect(footer(overlay, width)).not.toContain("following");
  });

  it("does not duplicate initial tail lines when revisiting a process", () => {
    const { overlay, width } = makeOverlay();

    // proc_1 has exactly one line. Turn follow off to expose the line count
    // in the status footer ("L1/1").
    overlay.handleInput("f");
    expect(footer(overlay, width)).toContain("L1/1");

    // Round-trip through proc_2 and back.
    overlay.handleInput(TAB);
    overlay.handleInput(TAB);

    // If the cached viewer were re-fed the initial tail, the buffer would
    // grow to two lines ("L2/2"). The cache must preserve the original.
    expect(footer(overlay, width)).toContain("L1/1");
    expect(footer(overlay, width)).not.toContain("L2/2");
  });
});
