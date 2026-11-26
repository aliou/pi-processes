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

    expect(component.handleMouse?.(clickEvent())).toMatchObject({
      handled: true,
    });
    const expanded = component.render(80);
    expect(expanded).toHaveLength(2);
    expect(expanded[1]).toMatch(/^ {2}/);
    expect(expanded[1]).toContain("id:");
    expect(expanded[1]).toContain("pattern:");
    expect(expanded[1]).toContain("stream:");
    expect(expanded[1]).not.toContain("notify:");

    expect(component.handleMouse?.(clickEvent())).toMatchObject({
      handled: true,
    });
    expect(component.render(80)).toHaveLength(1);
  });

  it("starts expanded when Pi passes expanded options", () => {
    const component = renderEntry(logMatchDetails(), { expanded: true });
    const lines = component.render(80);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^ {2}/);
  });

  it("keeps turn-triggered text normal and process names bold", () => {
    const theme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => `<bold>${text}</bold>`,
    } as Theme;
    const component = renderProcessNotificationMessage(
      { details: logMatchDetails() },
      { expanded: false, outputPad: 0 },
      theme,
    );

    expect(component?.render(200).map((line) => line.trimEnd())).toEqual([
      "<accent>[process]</accent> <warning>alerted</warning> <bold>`api-server`</bold> matched stdout: server ready on port 3000",
    ]);
  });

  it.each([
    {
      kind: "success",
      summary: 'Process "api-server" succeeded after 13s.',
      expected: "<success>succeeded after 13s.</success>",
    },
    {
      kind: "crash",
      summary: 'Process "api-server" failed with exit code 42 after 13s.',
      expected: "<error>failed with exit code 42 after 13s.</error>",
    },
  ] as const)(
    "colors $kind outcomes and preserves their duration",
    (fixture) => {
      const theme = {
        fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
        bold: (text: string) => text,
      } as Theme;
      const component = renderProcessNotificationMessage(
        {
          details: logMatchDetails({
            kind: fixture.kind,
            summary: fixture.summary,
            logMatch: undefined,
          }),
        },
        { expanded: false, outputPad: 0 },
        theme,
      );

      expect(component?.render(200).join("\n")).toContain(fixture.expected);
    },
  );

  it("dims context text in the summary and joined detail line", () => {
    const theme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => text,
    } as Theme;
    const component = renderProcessNotificationMessage(
      { details: logMatchDetails({ attention: "context" }) },
      { expanded: true, outputPad: 0 },
      theme,
    );

    const lines = component?.render(200).map((line) => line.trimEnd()) ?? [];
    expect(lines[0]).toContain(
      "<dim>matched stdout: server ready on port 3000</dim>",
    );
    expect(lines[0]).toContain("<dim>info</dim>");
    expect(lines[1]).toContain("  <muted>id:</muted> <dim>proc_1</dim>");
    expect(lines[1]).toContain('<muted>pattern:</muted> <dim>"ready"</dim>');
    expect(lines[1]).not.toContain("notify:");
  });

  it("keeps killed text regular while its info label stays dim", () => {
    const theme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => text,
    } as Theme;
    const component = renderProcessNotificationMessage(
      {
        details: logMatchDetails({
          kind: "killed",
          attention: "context",
          logMatch: undefined,
          signal: {
            name: "SIGTERM",
            number: 15,
            description: "termination request",
          },
        }),
      },
      { expanded: false, outputPad: 0 },
      theme,
    );

    const summary = component?.render(200).join("\n") ?? "";
    expect(summary).toContain(
      "<dim>info</dim> `api-server` killed by SIGTERM (15)",
    );
    expect(summary).not.toContain("<dim>killed by");
  });

  it("ignores non-click mouse events", () => {
    const component = renderEntry(logMatchDetails());
    expect(
      component.handleMouse?.({ ...clickEvent(), type: "press" }),
    ).toBeUndefined();
    expect(component.render(80)).toHaveLength(1);
  });

  it("clicking a lifecycle notification toggles its detail line", () => {
    const component = renderEntry(
      logMatchDetails({ kind: "success", logMatch: undefined }),
    );
    expect(component.render(80)).toHaveLength(1);

    expect(component.handleMouse?.(clickEvent())).toMatchObject({
      handled: true,
    });
    expect(component.render(80)).toHaveLength(2);

    expect(component.handleMouse?.(clickEvent())).toMatchObject({
      handled: true,
    });
    expect(component.render(80)).toHaveLength(1);
  });
});
