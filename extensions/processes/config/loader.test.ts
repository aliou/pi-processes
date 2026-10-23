import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./defaults";
import { resolveToolConfig } from "./loader";
import { type ProcessProtocolConfig, TOOL_EXPOSURES } from "./types";

function mergedWith(
  toolExposure: unknown,
): ProcessProtocolConfig & { toolExposure?: unknown } {
  return { ...structuredClone(DEFAULT_CONFIG), toolExposure };
}

describe("resolveToolConfig", () => {
  it("maps a merged toolExposure into the tool section", () => {
    const resolved = resolveToolConfig(mergedWith("deferred"));

    expect(resolved.tool).toEqual({ exposure: "deferred" });
    expect("toolExposure" in resolved).toBe(false);
  });

  it("keeps the default tool section when toolExposure is absent", () => {
    const merged = structuredClone(DEFAULT_CONFIG);
    const resolved = resolveToolConfig(merged);

    expect(resolved.tool).toBe(merged.tool);
    expect(resolved.tool).toEqual({ exposure: "direct" });
  });

  it("drops an invalid toolExposure instead of applying it", () => {
    const resolved = resolveToolConfig(mergedWith("always"));

    expect(resolved.tool).toEqual({ exposure: "direct" });
    expect("toolExposure" in resolved).toBe(false);
  });

  it("keeps extra keys of the tool section when mapping", () => {
    const merged = {
      ...structuredClone(DEFAULT_CONFIG),
      tool: { ...DEFAULT_CONFIG.tool, futureKey: true },
    } as ProcessProtocolConfig;

    const resolved = resolveToolConfig({
      ...merged,
      toolExposure: "deferred",
    } as ProcessProtocolConfig & { toolExposure?: unknown });

    expect(resolved.tool).toEqual({ futureKey: true, exposure: "deferred" });
  });

  it("applies every valid exposure", () => {
    for (const exposure of TOOL_EXPOSURES) {
      expect(resolveToolConfig(mergedWith(exposure)).tool).toEqual({
        exposure,
      });
    }
  });
});
