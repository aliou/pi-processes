import type {
  MessageRenderOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { ProcessNotificationDetails } from "../notifications/types";
import { renderProcessNotificationMessage } from "./notification-message";

function makeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}

function logMatchDetails(
  overrides: Partial<ProcessNotificationDetails> = {},
): ProcessNotificationDetails {
  return {
    kind: "log_match",
    processId: "proc_1",
    processName: "api-server",
    command: "npm run dev",
    timestamp: 1000,
    summary: "matched log output",
    attention: "turn",
    logMatch: {
      pattern: "ready",
      mode: "literal",
      stream: "stdout",
      line: "server ready on port 3000",
      matcherIndex: 0,
    },
    ...overrides,
  };
}

function renderEntry(
  details: ProcessNotificationDetails,
  options: Partial<MessageRenderOptions> = {},
): Component {
  const component = renderProcessNotificationMessage(
    { details },
    { expanded: false, outputPad: 0, ...options },
    makeTheme(),
  );
  if (!component) throw new Error("renderer returned no component");
  return component;
}

function clickEvent(): TuiMouseEvent {
  return {
    type: "click",
    button: "left",
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    width: 80,
    height: 1,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

describe("renderProcessNotificationMessage", () => {
  it("clicking a log-match entry toggles its detail line", () => {
    const component = renderEntry(logMatchDetails());

    const collapsed = component.render(80);
    expect(collapsed).toHaveLength(1);

    expect(component.handleMouse?.(clickEvent())).toEqual({ handled: true });
    const expanded = component.render(80);
    expect(expanded).toHaveLength(2);
    expect(expanded[1]).toContain("pattern:");

    expect(component.handleMouse?.(clickEvent())).toEqual({ handled: true });
    expect(component.render(80)).toHaveLength(1);
  });

  it("starts expanded when Pi passes expanded options", () => {
    const component = renderEntry(logMatchDetails(), { expanded: true });
    expect(component.render(80)).toHaveLength(2);
  });

  it("ignores non-click mouse events", () => {
    const component = renderEntry(logMatchDetails());
    expect(
      component.handleMouse?.({ ...clickEvent(), type: "press" }),
    ).toBeUndefined();
    expect(component.render(80)).toHaveLength(1);
  });

  it("does not toggle other notification kinds on click", () => {
    const component = renderEntry(
      logMatchDetails({ kind: "success", logMatch: undefined }),
    );
    expect(component.handleMouse?.(clickEvent())).toBeUndefined();
    expect(component.render(80)).toHaveLength(1);
  });
});
