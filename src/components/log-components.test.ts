import type { Theme } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ProcessManager } from "../manager";
import { LogDockComponent } from "./log-dock-component";
import { LogFileViewer } from "./log-file-viewer";
import { LogOverlayComponent } from "./log-overlay-component";

function createTheme(): Theme {
  const identity = (text: string) => text;
  return {
    fg: (_color: string, text: string) => text,
    bold: identity,
    inverse: identity,
  } as unknown as Theme;
}

describe("log components", () => {
  it("normalizes tabs in rendered log lines", () => {
    const viewer = new LogFileViewer({
      theme: createTheme(),
      getLines: () => [
        {
          type: "stderr",
          text: "\tat java.desktop/java.awt.EventDispatchThread.run(EventDispatchThread.java:92)",
        },
      ],
    });

    expect(viewer.renderLines(120, 1)).toEqual([
      "    at java.desktop/java.awt.EventDispatchThread.run(EventDispatchThread.java:92)",
    ]);
  });

  it("does not create polling timers", () => {
    vi.useFakeTimers();
    const intervalSpy = vi.spyOn(globalThis, "setInterval");

    const manager = new ProcessManager();
    const requestRender = vi.fn();
    const theme = createTheme();

    const dock = new LogDockComponent({
      manager,
      theme,
      tui: { requestRender },
      mode: "collapsed",
      focusedProcessId: null,
    });

    const overlay = new LogOverlayComponent({
      manager,
      theme,
      tui: { requestRender } as never,
      done: () => {},
    });

    expect(intervalSpy).not.toHaveBeenCalled();

    dock.dispose();
    overlay.handleInput("q");

    intervalSpy.mockRestore();
    vi.useRealTimers();
  });
});
