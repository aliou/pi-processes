import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { buildCollapsed, buildExpanded, findRemovedMatchers } from "./render";

describe("findRemovedMatchers", () => {
  it("returns removed matchers and preserves duplicate counts", () => {
    const ready = { pattern: "ready" };
    const warn = { pattern: "warn", stream: "stderr" as const };

    expect(findRemovedMatchers([ready, ready, warn], [ready])).toEqual([
      ready,
      warn,
    ]);
  });

  it("colors removed and added replacement prefixes", () => {
    const theme = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => `<bold>${text}</bold>`,
    } as Theme;
    const component = buildExpanded(
      {
        action: "update",
        ok: true,
        renamed: false,
        previousName: null,
        watches: {
          mode: "replace",
          before: [{ pattern: "old" }],
          applied: [{ pattern: "new" }],
          count: 1,
          items: [{ pattern: "new" }],
        },
      },
      theme,
    );

    const output = component.render(200).join("\n");
    expect(output).toContain("<error>- </error>");
    expect(output).toContain("<success>+ </success>");
    expect(output).toContain('<accent>"old"</accent>');
    expect(output).toContain('<accent>"new"</accent>');
  });

  it("uses an operation-first collapsed summary", () => {
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as Theme;
    const component = buildCollapsed(
      {
        action: "update",
        ok: true,
        renamed: false,
        previousName: null,
        watches: {
          mode: "append",
          before: [{ pattern: "old" }],
          applied: [{ pattern: "new" }],
          count: 2,
          items: [{ pattern: "old" }, { pattern: "new" }],
        },
      },
      theme,
    );

    expect(component.render(100).join("\n")).toContain(
      "watches: appended 1; 2 active",
    );
  });
});
