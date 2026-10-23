/**
 * Host renderCall contract coverage.
 *
 * The two hosts that load this extension invoke `renderCall` with different,
 * documented argument orders:
 *
 * - pi (earendil-works/pi): (args, theme, context) — the theme is a pi Theme
 *   class instance (modes/interactive/components/tool-execution.ts).
 * - oh-my-pi (can1357/oh-my-pi): (args, options, theme) — options is a plain
 *   { expanded, isPartial, spinnerFrame? } object (docs/extensions.md).
 *
 * renderProcessCall must render under both orders.
 */
import type {
  ExtensionAPI,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { assert, describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import { DEFAULT_CONFIG, TOOL_EXPOSURES } from "../config";
import type { NotificationRegistry } from "../notifications/registry";
import type { ProcessToolConfig } from "./index";
import { registerProcessTool } from "./index";

type RenderCallFn = NonNullable<ToolDefinition["renderCall"]>;
type RenderCallFnContext = Parameters<RenderCallFn>[2];

/** The normalized renderer accepts both host argument orders. */
type HostRenderCall = (
  args: Parameters<RenderCallFn>[0],
  second: Theme | RenderCallFnContext,
  third?: RenderCallFnContext | Theme,
) => ReturnType<RenderCallFn>;

/** Theme-like object, as passed by host Pi/OMP package copies. */
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function captureRegisteredTool(
  tool: ProcessToolConfig = DEFAULT_CONFIG.tool,
): ToolDefinition {
  const pi = { registerTool: vi.fn() } as unknown as ExtensionAPI;
  registerProcessTool(
    pi,
    {} as ProcessManager,
    {} as NotificationRegistry,
    tool,
  );
  const registered = vi.mocked(pi.registerTool).mock.calls[0]?.[0] as
    | ToolDefinition
    | undefined;
  assert(registered, "process tool was not registered");
  return registered;
}

function captureRenderCall(): HostRenderCall {
  const registered = captureRegisteredTool();
  assert(registered.renderCall, "process tool was not registered");
  return registered.renderCall as unknown as HostRenderCall;
}

describe("tool exposure", () => {
  it("registers with direct exposure from the default config", () => {
    expect(DEFAULT_CONFIG.tool.exposure).toBe("direct");
    expect(captureRegisteredTool().exposure).toBe("direct");
  });

  it("passes every configurable exposure through to the registered tool", () => {
    for (const exposure of TOOL_EXPOSURES) {
      expect(captureRegisteredTool({ exposure }).exposure).toBe(exposure);
    }
  });
});

describe("renderCall host argument order", () => {
  it("renders with pi order: (args, theme, context)", () => {
    const renderCall = captureRenderCall();
    const component = renderCall({ action: "list" }, theme, {
      expanded: false,
    } as RenderCallFnContext);
    expect(component.render(80).join("\n")).toContain("Process:");
  });

  it("renders with OMP order: (args, options, theme)", () => {
    const renderCall = captureRenderCall();
    const component = renderCall(
      { action: "list" },
      { expanded: false, isPartial: true } as RenderCallFnContext,
      theme,
    );
    expect(component.render(80).join("\n")).toContain("Process:");
  });
});
