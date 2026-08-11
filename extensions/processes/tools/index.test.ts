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
import {
  type ExtensionAPI,
  Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { ProcessManager } from "../../../src/manager";
import type { NotificationRegistry } from "../notifications/registry";
import { registerProcessTool } from "./index";

type RenderCallFn = NonNullable<ToolDefinition["renderCall"]>;
type RenderCallFnContext = Parameters<RenderCallFn>[2];

/** The normalized renderer accepts both host argument orders. */
type HostRenderCall = (
  args: Parameters<RenderCallFn>[0],
  second: Theme | RenderCallFnContext,
  third?: RenderCallFnContext | Theme,
) => ReturnType<RenderCallFn>;

/** pi's theme: a real Theme instance (passes `instanceof Theme`). */
const piTheme = Object.create(Theme.prototype) as Theme;
piTheme.fg = (_color: string, text: string) => text;
piTheme.bold = (text: string) => text;

/** OMP's theme: same surface, but not a pi Theme instance. */
const ompTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function captureRenderCall(): HostRenderCall {
  const pi = { registerTool: vi.fn() } as unknown as ExtensionAPI;
  registerProcessTool(pi, {} as ProcessManager, {} as NotificationRegistry);
  const tool = vi.mocked(pi.registerTool).mock.calls[0]?.[0] as ToolDefinition;
  if (!tool.renderCall) throw new Error("process tool was not registered");
  return tool.renderCall as unknown as HostRenderCall;
}

describe("renderCall host argument order", () => {
  it("renders with pi order: (args, theme, context)", () => {
    const renderCall = captureRenderCall();
    const component = renderCall({ action: "list" }, piTheme, {
      expanded: false,
    } as RenderCallFnContext);
    expect(component.render(80).join("\n")).toContain("Process:");
  });

  it("renders with OMP order: (args, options, theme)", () => {
    const renderCall = captureRenderCall();
    const component = renderCall(
      { action: "list" },
      { expanded: false, isPartial: true } as RenderCallFnContext,
      ompTheme,
    );
    expect(component.render(80).join("\n")).toContain("Process:");
  });
});
