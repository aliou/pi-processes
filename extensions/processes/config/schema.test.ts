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

  it("documents the current config version", () => {
    expect(
      schema.definitions.ProcessConfig.properties.version.description,
    ).toBe(
      `Config schema version, stamped by migrations. Current version: ${PROCESS_CONFIG_VERSION}.`,
    );
  });

  it("generates the schema with the current config version", () => {
    for (const script of [
      pkg.scripts["gen:schema"],
      pkg.scripts["check:schema"],
    ]) {
      expect(script.match(/--version\s+(\S+)/)?.[1]).toBe(
        PROCESS_CONFIG_VERSION,
      );
    }
  });
});
