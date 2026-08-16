import { EmptyState, Panel } from "@aliou/pi-utils-ui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ProcessInfo } from "../../../src/types";
import { CHANNELS } from "../../shared/protocol";
import { OverviewComponent } from "./overview-component";

const theme = {
  fg: (_c: string, t: string) => t,
  bg: (_c: string, t: string) => t,
  bold: (t: string) => t,
} as unknown;

/** Strip ANSI escape sequences without a literal ESC control char in source. */
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
function stripAnsi(line: string): string {
  return line.replace(ANSI, "");
}

function makeConfig() {
  return {
    execution: { shellPath: undefined },
    interception: { blockBackgroundCommands: true },
    processList: { maxPreviewLines: 24, maxVisibleProcesses: 12 },
    output: {
      defaultTailLines: 100,
      maxOutputLines: 2000,
      maxOutputBytes: 4 * 1024 * 1024,
    },
    follow: { enabledByDefault: true, autoHideOnFinish: false },
    widget: { dockDefaultState: "closed" as const, dockHeight: 12 },
  };
}

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

/** EventBus fake that replies synchronously to request/command channels. */
function makeEvents(processes: ProcessInfo[] = [], outputLines: string[] = []) {
  const listeners: Record<string, Array<(payload: never) => void>> = {};
  const pinCalls: (string | null)[] = [];
  return {
    on: vi.fn((channel: string, cb: (payload: never) => void) => {
      let list = listeners[channel];
      if (!list) {
        list = [];
        listeners[channel] = list;
      }
      list.push(cb);
      return () => {
        listeners[channel] = list.filter((l) => l !== cb);
      };
    }),
    emit: vi.fn((channel: string, payload: never) => {
      if (channel === CHANNELS.REQUEST_LIST) {
        (payload as { reply: (p: ProcessInfo[]) => void }).reply(processes);
        return;
      }
      if (channel === CHANNELS.REQUEST_COMBINED_OUTPUT) {
        const out: Array<{ type: "stdout"; text: string }> = outputLines.length
          ? outputLines.map((text) => ({ type: "stdout" as const, text }))
          : [
              { type: "stdout" as const, text: "line one" },
              { type: "stdout" as const, text: "line two" },
            ];
        (payload as { reply: (lines: typeof out) => void }).reply(out);
        return;
      }
      if (channel === CHANNELS.COMMAND_PIN) {
        const p = payload as {
          id: string | null;
          reply: (r: { ok: true }) => void;
        };
        pinCalls.push(p.id);
        p.reply({ ok: true });
        return;
      }
    }),
    dispatch(channel: string, payload: unknown) {
      for (const listener of listeners[channel] ?? []) {
        listener(payload as never);
      }
    },
    pinCalls,
  };
}

describe("overview panel render width safety", () => {
  it("never exceeds terminal width across a range of widths (empty state)", () => {
    const events = makeEvents();
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });
    for (const w of [112, 100, 80, 60, 45, 40, 30, 20, 10, 5]) {
      const lines = component.render(w);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(w);
      }
    }
  });

  it("never exceeds terminal width with populated rows + preview", () => {
    const processes = [
      makeProcess({
        id: "proc_1",
        name: "dev",
        command: "pnpm dev",
        status: "running",
        startTime: 100,
      }),
      makeProcess({
        id: "proc_2",
        name: "a-very-long-process-name-that-exceeds",
        command: "node server.js --port 3000 --host 0.0.0.0 --verbose",
        status: "exited",
        success: true,
        startTime: 50,
        endTime: 80,
      }),
    ];
    const events = makeEvents(processes);
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });
    for (const w of [112, 100, 80, 60, 45, 40, 30, 20, 10, 5]) {
      const lines = component.render(w);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(w);
      }
    }
  });

  it("empty state panel via Panel never exceeds width", () => {
    const empty = new EmptyState({
      title: "No managed processes",
      description: "Start one with the process tool, then reopen /ps",
      titleStyle: (t: string) => t,
      descriptionStyle: (t: string) => t,
      padding: 2,
    });
    const panel = new Panel({
      title: undefined,
      body: empty,
      border: "round",
      padding: 0,
      borderStyle: (t: string) => t,
      titleStyle: (t: string) => t,
    });
    for (const w of [112, 80, 40, 20, 10]) {
      const lines = panel.render(w);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(w);
      }
    }
  });

  it("empty state title and description are horizontally centered", () => {
    const events = makeEvents();
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });
    const width = 112;
    const contentWidth = width - 2;
    const lines = component.render(width);
    const plain = lines.map(stripAnsi);

    const title = "No managed processes";
    const description = "Start one with the process tool, then reopen /ps";
    const titleIdx = plain.findIndex((l) => l.includes(title));
    const descIdx = plain.findIndex((l) => l.includes(description));
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(descIdx).toBeGreaterThan(titleIdx);

    const titleStart = plain[titleIdx].indexOf(title);
    const descStart = plain[descIdx].indexOf(description);
    // Centered => border(1) + floor((contentWidth - textWidth) / 2).
    expect(titleStart).toBe(1 + Math.floor((contentWidth - title.length) / 2));
    expect(descStart).toBe(
      1 + Math.floor((contentWidth - description.length) / 2),
    );
  });

  it("empty state stays centered when theme.fg emits ANSI escape codes", () => {
    // A theme whose fg wraps text in ANSI codes. visibleWidth() must ignore
    // the escape codes; .length-based centering (the EmptyState bug) would
    // shift content left.
    const ansiTheme = {
      fg: (_c: string, t: string) => `\x1b[38;5;245m${t}\x1b[0m`,
      bg: (_c: string, t: string) => t,
      bold: (t: string) => `\x1b[1m${t}\x1b[0m`,
    } as unknown;
    const events = makeEvents();
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: ansiTheme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });
    const width = 112;
    const contentWidth = width - 2;
    const lines = component.render(width);
    // Strip ANSI to inspect visible positions reliably (slicing the raw string
    // would mangle escape codes).
    const plain = lines.map(stripAnsi);
    const title = "No managed processes";
    const description = "Start one with the process tool, then reopen /ps";
    const titleIdx = plain.findIndex((l) => l.includes(title));
    const descIdx = plain.findIndex((l) => l.includes(description));
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(descIdx).toBeGreaterThan(titleIdx);

    const titleStart = plain[titleIdx].indexOf(title);
    const descStart = plain[descIdx].indexOf(description);
    // Panel adds a 1-char border on each side, so the body content starts at
    // col 1. Centered => border(1) + floor((contentWidth - textWidth) / 2).
    expect(titleStart).toBe(1 + Math.floor((contentWidth - title.length) / 2));
    expect(descStart).toBe(
      1 + Math.floor((contentWidth - description.length) / 2),
    );
  });

  it("empty state mentions changing the filter when processes exist but are filtered out", () => {
    const processes = [
      makeProcess({ id: "proc_1", name: "dev", status: "running" }),
    ];
    const events = makeEvents(processes);
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });
    // Switch filter to "finished" so the running process is hidden.
    component.handleInput("f");
    component.handleInput("f");
    const lines = component.render(112);
    const joined = lines.join("\n");
    expect(joined).toContain("No managed processes");
    expect(joined).toContain("No processes match the current filter");
    expect(joined).not.toContain("Start one with the process tool");
  });

  it("enter pins the selected process, then enter again unpins it (toggle)", async () => {
    const processes = [
      makeProcess({ id: "proc_1", name: "dev", status: "running" }),
    ];
    const events = makeEvents(processes);
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });

    // First enter: pin proc_1.
    component.handleInput("\r");
    await Promise.resolve();
    await Promise.resolve();
    expect(events.pinCalls).toEqual(["proc_1"]);
    // Footer should now offer "unpin".
    let footer = component.render(112).join("\n");
    expect(footer).toContain("unpin");

    // Second enter: unpin (id: null).
    component.handleInput("\r");
    await Promise.resolve();
    await Promise.resolve();
    expect(events.pinCalls).toEqual(["proc_1", null]);
    footer = component.render(112).join("\n");
    expect(footer).toContain("pin");
    expect(footer).not.toContain("unpin");
  });

  it("the pinned process row shows a pinned marker", async () => {
    const processes = [
      makeProcess({ id: "proc_1", name: "dev", status: "running" }),
    ];
    const events = makeEvents(processes);
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });

    expect(events.pinCalls).toEqual([]);
    component.handleInput("\r");
    await Promise.resolve();
    await Promise.resolve();
    expect(events.pinCalls).toEqual(["proc_1"]);
    // The pinned row should render the marker.
    const lines = component.render(112);
    const body = lines.map(stripAnsi);
    const row = body.find((l) => l.includes("proc_1"));
    expect(row).toBeTruthy();
    expect(row).toContain("◆");
  });

  it("does not pin finished processes", async () => {
    const processes = [
      makeProcess({
        id: "proc_1",
        name: "done",
        status: "exited",
        success: true,
        endTime: 200,
      }),
    ];
    const events = makeEvents(processes);
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });

    component.handleInput("\r");
    await Promise.resolve();
    await Promise.resolve();
    expect(events.pinCalls).toEqual([]);
    expect(component.render(112).join("\n")).toContain("pin running only");
  });

  it("renders left meta, centered title, and right scroll indicators in the panel header", () => {
    const processes = Array.from({ length: 16 }, (_, index) =>
      makeProcess({
        id: `proc_${index + 1}`,
        name: `proc-${index + 1}`,
        status: "running",
        startTime: 100 - index,
      }),
    );
    const events = makeEvents(processes);
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });

    const header = stripAnsi(component.render(112)[0] ?? "");
    expect(header.startsWith("╭")).toBe(true);
    expect(header.endsWith("╮")).toBe(true);
    expect(header).toContain("16/16 running");
    expect(header).toContain("Processes");
    expect(header).toContain("↓ 4 more");

    const titleStart = header.indexOf("Processes");
    const center = Math.floor(header.length / 2);
    expect(Math.abs(titleStart + "Processes".length / 2 - center)).toBeLessThan(
      2,
    );
    expect(header.slice(0, titleStart)).toContain("─");
    expect(header.slice(titleStart + "Processes".length)).toContain("─");
  });

  it("defaults the preview to the newest output page (newest-first)", () => {
    // More lines than the fixed preview height (PREVIEW_HEIGHT = 8) so the
    // newest-first default is observable: selecting/opening lands on the
    // last page, not the first (oldest) page.
    const lines = Array.from({ length: 12 }, (_, i) => `out line ${i + 1}`);
    const processes = [
      makeProcess({ id: "proc_1", name: "dev", status: "running" }),
    ];
    const events = makeEvents(processes, lines);
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });

    const body = component.render(112).map(stripAnsi).join("\n");
    // Newest page is lines 5-12 (12 total, height 8 -> start at 12-8=4 -> 5-12).
    expect(body).toContain("5-12 of 12");
    expect(body).toContain("out line 12");
    expect(body).toContain("out line 5");
    // The oldest lines (1-4) are off the newest page.
    expect(body).not.toContain("out line 4");
    expect(body).not.toContain("out line 1 ");
  });

  it("keeps the preview height stable for short and paginated output", () => {
    const processes = [
      makeProcess({ id: "proc_1", name: "dev", status: "running" }),
    ];
    const tui = {
      requestRender: () => {},
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const shortPreview = new OverviewComponent({
      events: makeEvents(processes, ["only line"]) as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    }).render(112);
    const paginatedPreview = new OverviewComponent({
      events: makeEvents(
        processes,
        Array.from({ length: 12 }, (_, index) => `out line ${index + 1}`),
      ) as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    }).render(112);

    expect(shortPreview).toHaveLength(paginatedPreview.length);
    expect(shortPreview.map(stripAnsi).join("\n")).not.toContain("of 12");
    expect(paginatedPreview.map(stripAnsi).join("\n")).toContain("5-12 of 12");
  });

  it("appends output events without re-reading the log tail", () => {
    const processes = [makeProcess({ id: "proc_1" })];
    const events = makeEvents(processes, ["initial"]);
    const tui = {
      requestRender: vi.fn(),
      terminal: { rows: 24, columns: 112 },
    } as unknown;
    const component = new OverviewComponent({
      events: events as never,
      tui: tui as never,
      theme: theme as never,
      config: makeConfig() as never,
      onClose: () => {},
    });
    const requestsBefore = events.emit.mock.calls.filter(
      ([channel]) => channel === CHANNELS.REQUEST_COMBINED_OUTPUT,
    ).length;

    events.dispatch(CHANNELS.OUTPUT_CHANGED, {
      id: "proc_1",
      droppedLines: 2,
      appendedText: [{ type: "stdout", text: "live line" }],
    });

    const body = component.render(112).map(stripAnsi).join("\n");
    expect(body).toContain("… 2 lines dropped (output too fast)");
    expect(body).toContain("live line");
    expect(
      events.emit.mock.calls.filter(
        ([channel]) => channel === CHANNELS.REQUEST_COMBINED_OUTPUT,
      ),
    ).toHaveLength(requestsBefore);
  });
});
