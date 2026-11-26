import type {
  MessageRenderOptions,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type {
  ProcessesStoppedDetails,
  StoppedProcessRecord,
} from "../hooks/stopped-notice";
import { renderStoppedNoticeMessage } from "./stopped-notice-message";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const original = await importOriginal<object>();
  return { ...original, keyText: () => "ctrl+o" };
});

function makeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
}

function details(
  processes: StoppedProcessRecord[] = [
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

const click: TuiMouseEvent = {
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

  it("renders only the singular summary when collapsed", () => {
    const lines = render(details()).render(80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("1 process was not resumed");
    expect(lines[0]).toContain("(ctrl+o to expand)");
    expect(lines[0]).not.toContain("api-server");
  });

  it("renders a plural summary and process rows when expanded", () => {
    const lines = render(
      details([
        { name: "api-server", command: "npm run dev" },
        { name: "watcher", command: "node watcher.mjs" },
      ]),
      { expanded: true },
    ).render(80);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("2 processes were not resumed");
    expect(lines[0]).toContain("(ctrl+o to collapse)");
    expect(lines[1]).toContain("api-server");
    expect(lines[1]).toContain("npm run dev");
    expect(lines[2]).toContain("watcher");
    expect(lines[2]).toContain("node watcher.mjs");
  });

  it("dims the notice while bolding process names and accenting commands", () => {
    const theme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => `<bold>${text}</bold>`,
    } as Theme;
    const component = renderStoppedNoticeMessage(
      { details: details() },
      { expanded: true, outputPad: 0 },
      theme,
    );

    const lines = component?.render(80).map((line) => line.trimEnd()) ?? [];
    expect(lines[0]).toContain("<dim>1 process was not resumed</dim>");
    expect(lines.find((line) => line.includes("api-server"))).toContain(
      "  <bold>api-server</bold> <accent>npm run dev</accent>",
    );
  });

  it("clicking the summary expands and clicking a process row collapses", () => {
    const component = render(details());

    expect(component.handleMouse?.(click)).toMatchObject({ handled: true });
    const expanded = component.render(80);
    expect(expanded).toHaveLength(2);
    expect(expanded[0]).toContain("(ctrl+o to collapse)");

    expect(
      component.handleMouse?.({ ...click, y: 1, screenY: 1, height: 2 }),
    ).toMatchObject({ handled: true });
    const collapsed = component.render(80);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toContain("(ctrl+o to expand)");
  });

  it("ignores non-click mouse events", () => {
    const component = render(details());
    expect(
      component.handleMouse?.({ ...click, type: "press" }),
    ).toBeUndefined();
    expect(component.render(80)).toHaveLength(1);
  });
});
