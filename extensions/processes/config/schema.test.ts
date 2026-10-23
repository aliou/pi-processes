import { describe, expect, it } from "vitest";

import pkg from "../../../package.json" with { type: "json" };
import schema from "../../../schema.json" with { type: "json" };
import { PROCESS_CONFIG_VERSION } from "./migrations";
import {
  PROCESS_CONFIG_SCHEMA_URL,
  PROCESS_CONFIG_SCHEMA_VERSION,
} from "./schema";

describe("process config schema", () => {
  it("uses the package version", () => {
    expect(PROCESS_CONFIG_SCHEMA_VERSION).toBe(pkg.version);
    expect(PROCESS_CONFIG_SCHEMA_URL).toContain(
      `@aliou/pi-processes@${pkg.version}/schema.json`,
    );
  });

  it("documents the version key without embedding the config version", () => {
    expect(
      schema.definitions.ProcessConfig.properties.version.description,
    ).toBe("Config schema version, stamped by migrations.");
  });

  it("exposes toolExposure with every configurable exposure", () => {
    expect(schema.definitions.ProcessConfig.properties.toolExposure).toEqual({
      $ref: "#/definitions/ToolExposure",
    });
    expect(schema.definitions.ToolExposure.enum).toEqual([
      "direct",
      "model-only",
      "codemode",
      "deferred",
      "hidden",
    ]);
  });

  it("generates the schema without a version flag", () => {
    for (const script of [
      pkg.scripts["gen:schema"],
      pkg.scripts["check:schema"],
    ]) {
      expect(script).not.toMatch(/--version/);
    }
  });

  it("stamps the next package minor as the config version", () => {
    const [major, minor] = pkg.version.split(".").map(Number);
    expect(PROCESS_CONFIG_VERSION).toBe(`${major}.${minor + 1}.0`);
  });
});
