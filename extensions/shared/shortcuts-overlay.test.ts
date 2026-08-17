import type { Theme } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { ShortcutGroup } from "./shortcuts-overlay";
import {
  computeShortcutsOverlayWidth,
  ShortcutsOverlayComponent,
  showShortcutsOverlay,
} from "./shortcuts-overlay";

const theme = {
  fg: (_c: string, t: string) => t,
  bg: (_c: string, t: string) => `[_${t}_]`,
  bold: (t: string) => t,
} as unknown as Theme;

const ESC = String.fromCharCode(27);
/** Width wide enough to render the fixture groups untruncated. */
const PANEL_WIDTH = 48;
const CTRL_C = String.fromCharCode(3);

const groups: ShortcutGroup[] = [
  {
    title: "scrolling",
    rows: [
      { keys: "j / k", description: "line up / down" },
      { keys: "ctrl+u / ctrl+d", description: "half page up / down" },
    ],
  },
  {
    title: "view",
    rows: [{ keys: "w", description: "wrap long lines" }],
  },
];

/** Strip the test theme's bg-pill markers for plain-text assertions. */
function stripPill(line: string): string {
  return line.replace(/\[_|\]/g, "");
}

describe("ShortcutsOverlayComponent", () => {
  function makeComponent(onDismiss = vi.fn()) {
    return {
      onDismiss,
      component: new ShortcutsOverlayComponent({
        theme: theme as never,
        groups,
        onDismiss,
      }),
    };
  }

  it("renders the keybinds title, esc close pill, groups, and aligned rows", () => {
    const { component } = makeComponent();
    const lines = component.render(PANEL_WIDTH).map(stripPill);
    const rendered = lines.join("\n");

    // Title centered in the top border.
    expect(lines[0]).toContain("keybinds");
    // Close pill on the first body row.
    expect(lines[1]).toContain("esc close");
    // Group headers and their rows.
    expect(rendered).toContain("scrolling");
    expect(rendered).toContain("view");
    expect(rendered).toContain("j / k");
    expect(rendered).toContain("line up / down");
    expect(rendered).toContain("wrap long lines");
  });

  it("aligns all descriptions in one column shared across groups", () => {
    const { component } = makeComponent();
    const lines = component.render(PANEL_WIDTH).map(stripPill).slice(2); // drop title row

    const descriptionCol = "line up / down".length;
    const indexOf = (text: string) =>
      lines.find((line) => line.includes(text))?.indexOf(text) ?? -1;

    // Every description starts at the same column.
    const columns = [
      indexOf("line up / down"),
      indexOf("half page up / down"),
      indexOf("wrap long lines"),
    ];
    expect(new Set(columns).size).toBe(1);
    expect(columns[0]).toBeGreaterThan(0);
    expect(descriptionCol).toBeGreaterThan(0);
  });

  it("separates groups with a blank line", () => {
    const { component } = makeComponent();
    const lines = component.render(PANEL_WIDTH).map(stripPill);
    const scrolling = lines.findIndex((line) => line.includes("scrolling"));
    const view = lines.findIndex((line) => line.includes("view"));
    // scrolling group: header + 2 rows, then one blank line before "view".
    const separator = lines[scrolling + 3] ?? "";
    expect(separator.slice(1, -1).trim()).toBe("");
    expect(view).toBe(scrolling + 4);
  });

  it("dismisses on ?, escape, enter, q, and ctrl+c", () => {
    for (const key of ["?", `${ESC}`, "\r", "q", CTRL_C]) {
      const { component, onDismiss } = makeComponent();
      component.handleInput(key);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores keys that are not dismissals", () => {
    const { component, onDismiss } = makeComponent();
    component.handleInput("x");
    component.handleInput("w");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("never renders a line wider than the requested width", () => {
    const { component } = makeComponent();
    // Strip SGR escapes without a literal ESC control char in the regex.
    const CSI = String.fromCharCode(27);
    const SGR = new RegExp(`${CSI}\\[[0-9;]*m`, "g");
    for (const width of [80, 60, 48, 40, 36]) {
      for (const line of component.render(width)) {
        expect(line.replace(SGR, "").length).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe("computeShortcutsOverlayWidth", () => {
  it("sizes the panel so the longest aligned row renders untruncated", () => {
    const component = new ShortcutsOverlayComponent({
      theme: theme as never,
      groups,
      onDismiss: () => {},
    });
    const width = computeShortcutsOverlayWidth(groups);
    const longestDescription = "half page up / down";
    expect(component.render(width).join("\n")).toContain(longestDescription);
  });

  it("stops growing once the panel hits its maximum width", () => {
    const long: ShortcutGroup[] = [
      {
        title: "g",
        rows: [{ keys: "a", description: "x".repeat(200) }],
      },
    ];
    const longer: ShortcutGroup[] = [
      {
        title: "g",
        rows: [{ keys: "a", description: "x".repeat(300) }],
      },
    ];
    const width = computeShortcutsOverlayWidth(long);
    expect(computeShortcutsOverlayWidth(longer)).toBe(width);
  });
});

describe("showShortcutsOverlay", () => {
  it("pushes a centered overlay and the disposer hides it exactly once", () => {
    const hide = vi.fn();
    const shown: { component: unknown; options: unknown }[] = [];
    const requestRender = vi.fn();
    const tui = {
      requestRender,
      showOverlay: vi.fn((component: unknown, options: unknown) => {
        shown.push({ component, options });
        return { hide } as unknown as OverlayHandle;
      }),
    } as unknown as TUI;

    const dispose = showShortcutsOverlay(tui as never, {
      theme: theme as never,
      groups,
    });

    expect(tui.showOverlay).toHaveBeenCalledTimes(1);
    const options = shown[0]?.options as { anchor: string };
    expect(options.anchor).toBe("center");

    // Dismissing through the component routes to the same single hide.
    const component = shown[0]?.component as ShortcutsOverlayComponent;
    component.handleInput(`${ESC}`);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(requestRender).toHaveBeenCalled();

    // The returned disposer is idempotent.
    dispose();
    dispose();
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
