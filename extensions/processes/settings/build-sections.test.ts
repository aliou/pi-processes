import { describe, expect, it } from "vitest";
import type { ProcessConfig } from "../config";
import { DEFAULT_CONFIG } from "../config";
import { buildSections } from "./build-sections";

describe("buildSections", () => {
  const resolved = { ...DEFAULT_CONFIG };
  const ctx = {
    setDraft: () => {},
    scope: "global" as const,
    isInherited: (_path: string) => false,
    theme: new Proxy(
      {},
      {
        get: () => (value: string) => value,
      },
    ) as never,
  };

  it("produces focused top-level sections", () => {
    const sections = buildSections(null, resolved, ctx);
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual(["Core", "Interfaces"]);
  });

  it("distinguishes scoped vs inherited core values", () => {
    const scoped: ProcessConfig = {
      interception: { blockBackgroundCommands: true },
    };
    const sections = buildSections(scoped, resolved, ctx);

    const inherited = buildSections(null, resolved, ctx);
    const getBlockerValue = (s: typeof sections) =>
      s
        .find((s) => s.label === "Core")
        ?.items.find((i) => i.id === "interception.blockBackgroundCommands")
        ?.currentValue;

    expect(getBlockerValue(sections)).toBe("on");
    expect(getBlockerValue(inherited)).toBe("inherited: off");
  });

  it("cycles tool exposure as an inline item", () => {
    const scoped: ProcessConfig = { toolExposure: "deferred" };
    const sections = buildSections(scoped, resolved, ctx);
    const exposureItem = sections
      .find((s) => s.label === "Core")
      ?.items.find((item) => item.id === "toolExposure");

    expect(exposureItem?.currentValue).toBe("deferred");
    expect(exposureItem?.values).toEqual([
      "direct",
      "model-only",
      "codemode",
      "deferred",
      "hidden",
    ]);

    const inherited = buildSections(null, resolved, ctx);
    const inheritedItem = inherited
      .find((s) => s.label === "Core")
      ?.items.find((item) => item.id === "toolExposure");
    expect(inheritedItem?.currentValue).toBe("inherited: direct");
  });

  it("offers tool exposure only in the global scope", () => {
    for (const scope of ["local", "memory"] as const) {
      const sections = buildSections({ toolExposure: "deferred" }, resolved, {
        ...ctx,
        scope,
      });
      const ids = sections
        .find((s) => s.label === "Core")
        ?.items.map((item) => item.id);
      expect(ids).not.toContain("toolExposure");
    }
  });

  it("summarizes logs settings in a submenu item", () => {
    const scoped: ProcessConfig = {
      output: { maxOutputLines: 500 },
      processList: { maxPreviewLines: 12 },
      follow: { enabledByDefault: false },
    };
    const sections = buildSections(scoped, resolved, ctx);
    const logsItem = sections
      .find((s) => s.label === "Interfaces")
      ?.items.find((item) => item.id === "logs.details");

    expect(logsItem?.currentValue).toBe("500 lines · 4 MB · 12 rows · manual");
    expect(logsItem?.submenu).toBeTypeOf("function");
  });
});
