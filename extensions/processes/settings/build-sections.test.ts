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
  };

  it("produces all expected section labels", () => {
    const sections = buildSections(null, resolved, ctx);
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual(["Execution", "Interception"]);
  });

  it("distinguishes scoped vs inherited values", () => {
    const scoped: ProcessConfig = {
      interception: { blockBackgroundCommands: false },
    };
    const sections = buildSections(scoped, resolved, ctx);

    const inherited = buildSections(null, resolved, ctx);
    const getBlockerValue = (s: typeof sections) =>
      s
        .find((s) => s.label === "Interception")
        ?.items.find((i) => i.id === "interception.blockBackgroundCommands")
        ?.currentValue;

    expect(getBlockerValue(sections)).toBe("off");
    expect(getBlockerValue(inherited)).toBe("inherited: on");
  });
});
