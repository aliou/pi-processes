import type {
  ExtensionAPI,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { ProcessManager } from "../manager";
import { setupProcessesTools } from ".";

describe("process tool renderer", () => {
  function setupRenderer() {
    let renderCall: ((...args: unknown[]) => Component) | undefined;
    const pi = {
      registerTool(tool: { renderCall?: (...args: unknown[]) => Component }) {
        renderCall = tool.renderCall;
      },
    } as unknown as ExtensionAPI;
    const options = {
      expanded: false,
      isPartial: false,
    } as ToolRenderResultOptions;
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as Theme;

    setupProcessesTools(pi, {} as ProcessManager);

    return { options, renderCall, theme };
  }

  it("renders with OMP argument order", () => {
    const { options, renderCall, theme } = setupRenderer();

    expect(
      renderCall?.({ action: "list" }, options, theme).render(80).join("\n"),
    ).toContain("Process:");
  });

  it("renders with Earendil argument order", () => {
    const { options, renderCall, theme } = setupRenderer();

    expect(
      renderCall?.({ action: "list" }, theme, options).render(80).join("\n"),
    ).toContain("Process:");
  });
});
