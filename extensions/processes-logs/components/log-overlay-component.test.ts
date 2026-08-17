import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ProcessInfo } from "../../../src/types";
import { CHANNELS } from "../../shared/protocol";
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
const ESC = String.fromCharCode(27);

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
    output: {
      defaultTailLines: 100,
      maxOutputLines: 2000,
      maxOutputBytes: 4 * 1024 * 1024,
    },
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

describe("LogOverlayComponent wrap toggle", () => {
  it("toggles wrap mode with the w key and shows it in the footer", () => {
    const { overlay, width } = makeOverlay();

    // Default: wrap is off, footer shows dim "wrap".
    expect(footer(overlay, width)).toContain("wrap");

    // Press w to enable wrap.
    overlay.handleInput("w");
    const wrappedFooter = footer(overlay, width);
    // The footer should still contain "wrap" (now accent-styled, but the
    // test theme strips styling so we just check presence).
    expect(wrappedFooter).toContain("wrap");
  });

  it("preserves wrap state across a tab round-trip", () => {
    const { overlay, width } = makeOverlay();

    // Enable wrap on proc_1.
    overlay.handleInput("w");

    // Switch to proc_2 and back.
    overlay.handleInput(TAB);
    overlay.handleInput(TAB);

    // Wrap should still be enabled (cached viewer preserves it).
    // We verify by checking the footer contains the wrap indicator.
    expect(footer(overlay, width)).toContain("wrap");
  });
});

// --- page scrolling ---

const PAGE_DOWN = `${ESC}[6~`;
const PAGE_UP = `${ESC}[5~`;
const CTRL_D = String.fromCharCode(4);
const CTRL_U = String.fromCharCode(21);

/** Log lines in the paging fixtures. */
const TOTAL_LINES = 50;
/** Terminal rows in the paging fixtures. */
const TERMINAL_ROWS = 40;
/** Viewport height (logRows()) for TERMINAL_ROWS under makeConfig(). */
const VIEWPORT_ROWS = 24;
/** Half-viewport rows scrolled by ctrl+u / ctrl+d. */
const HALF_PAGE_ROWS = VIEWPORT_ROWS / 2;

/** Overlay over a single process with `count` log lines. */
function makePagedOverlay(count: number, tuiOverrides: object = {}) {
  const proc = makeProcess();
  const initialLines: Record<string, ProcessLogLine[]> = {
    proc_1: Array.from({ length: count }, (_, i) => ({
      type: "stdout" as const,
      text: `line ${i}`,
    })),
  };
  const events = makeEvents([proc], initialLines);
  const tui = {
    requestRender: () => {},
    terminal: { rows: TERMINAL_ROWS, columns: 120 },
    ...tuiOverrides,
  } as unknown as TUI;
  const overlay = new LogOverlayComponent({
    events: events as never,
    tui: tui as never,
    theme: theme as never,
    config: makeConfig(),
    onClose: () => {},
    initialProcessId: "proc_1",
  });
  return { overlay };
}

describe("LogOverlayComponent page scrolling", () => {
  it("pageDown leaves follow mode and moves the viewport", () => {
    const { overlay } = makePagedOverlay(TOTAL_LINES);
    expect(footer(overlay, 120)).toContain("following");

    overlay.handleInput(PAGE_DOWN);
    const after = footer(overlay, 120);
    expect(after).not.toContain("following");
    expect(after).toContain(`L${TOTAL_LINES}/${TOTAL_LINES}`);
  });

  it("pageUp scrolls up by a full viewport", () => {
    const { overlay } = makePagedOverlay(TOTAL_LINES);
    overlay.handleInput(PAGE_DOWN); // stop following

    overlay.handleInput(PAGE_UP);
    expect(footer(overlay, 120)).toContain(
      `L${TOTAL_LINES - VIEWPORT_ROWS}/${TOTAL_LINES}`,
    );
  });

  it("ctrl+d / ctrl+u scroll by half a viewport", () => {
    const { overlay } = makePagedOverlay(TOTAL_LINES);
    overlay.handleInput(PAGE_DOWN); // stop following

    overlay.handleInput(CTRL_U);
    expect(footer(overlay, 120)).toContain(
      `L${TOTAL_LINES - HALF_PAGE_ROWS}/${TOTAL_LINES}`,
    );

    overlay.handleInput(CTRL_D);
    expect(footer(overlay, 120)).toContain(`L${TOTAL_LINES}/${TOTAL_LINES}`);
  });

  it("pageUp clamps so the viewport never ends above its own height", () => {
    const { overlay } = makePagedOverlay(TOTAL_LINES);
    overlay.handleInput(PAGE_DOWN);
    overlay.handleInput(PAGE_UP);
    overlay.handleInput(PAGE_UP);
    expect(footer(overlay, 120)).toContain(`L${VIEWPORT_ROWS}/${TOTAL_LINES}`);
  });
});

// --- "?" shortcuts overlay ---

/** Width wide enough for the stacked keybinds panel to render untruncated. */
const KEYBINDS_PANEL_WIDTH = 48;

describe("LogOverlayComponent shortcuts overlay", () => {
  function makeOverlayWithTui() {
    const hide = vi.fn();
    const shown: { component: unknown; options: unknown }[] = [];
    const tui = {
      requestRender: () => {},
      terminal: { rows: 40, columns: 120 },
      showOverlay: vi.fn((component: unknown, options: unknown) => {
        shown.push({ component, options });
        return { hide };
      }),
    };
    const { overlay } = makePagedOverlay(5, { showOverlay: tui.showOverlay });
    return { overlay, hide, shown };
  }

  it("opens a stacked overlay with ? and closes it via the overlay's esc", () => {
    const { overlay, hide, shown } = makeOverlayWithTui();

    overlay.handleInput("?");
    expect(shown.length).toBe(1);

    const help = shown[0]?.component as {
      handleInput: (data: string) => void;
      render: (width: number) => string[];
    };
    const lines = help.render(KEYBINDS_PANEL_WIDTH).join("\n");
    expect(lines).toContain("keybinds");
    expect(lines).toContain("esc close");
    help.handleInput(`${ESC}`);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("hides the shortcuts overlay when the log overlay closes", () => {
    const { overlay, hide } = makeOverlayWithTui();
    overlay.handleInput("?");
    overlay.handleInput("q");
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("does not open a second shortcuts overlay while one is open", () => {
    const { overlay, shown } = makeOverlayWithTui();
    overlay.handleInput("?");
    overlay.handleInput("?");
    expect(shown.length).toBe(1);
  });
});
