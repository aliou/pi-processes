import type {
  MessageRenderOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { ProcessesStoppedDetails } from "../hooks/stopped-notice";
import { renderStoppedNoticeMessage } from "./stopped-notice-message";

function makeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}

function details(
  processes: ProcessesStoppedDetails["processes"] = [
    { name: "api-server", command: "npm run dev" },
  ],
): ProcessesStoppedDetails {
  return { processes };
}

function render(
  messageDetails: ProcessesStoppedDetails | undefined,
  options: Partial<MessageRenderOptions> = {},
): Component {
  const component = renderStoppedNoticeMessage(
    { details: messageDetails },
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

describe("renderStoppedNoticeMessage", () => {
  it("returns no component without details", () => {
    expect(
      renderStoppedNoticeMessage(
        {},
        { expanded: false, outputPad: 0 },
        makeTheme(),
      ),
    ).toBeUndefined();
  });

  it("renders a count line when collapsed", () => {
    const lines = render(details()).render(80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("1 background process was stopped");
  });

  it("uses a plural count line for several processes", () => {
    const lines = render(
      details([
        { name: "a", command: "a" },
        { name: "b", command: "b" },
      ]),
    ).render(80);
    expect(lines[0]).toContain("2 background processes were stopped");
  });

  it("lists name and command when expanded", () => {
    const lines = render(details(), { expanded: true }).render(80);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("api-server");
    expect(lines[1]).toContain("npm run dev");
  });

  it("starts expanded when Pi passes expanded options", () => {
    const component = render(details(), { expanded: true });
    expect(component.render(80)).toHaveLength(2);
  });

  it("clicking toggles the process list", () => {
    const component = render(details());

    expect(component.handleMouse?.(clickEvent())).toEqual({ handled: true });
    expect(component.render(80)).toHaveLength(2);

    component.handleMouse?.(clickEvent());
    expect(component.render(80)).toHaveLength(1);
  });

  it("ignores non-click mouse events", () => {
    const component = render(details());
    expect(
      component.handleMouse?.({ ...clickEvent(), type: "press" }),
    ).toBeUndefined();
    expect(component.render(80)).toHaveLength(1);
  });
});
