import { describe, expect, it } from "vitest";

import pkg from "../../../package.json" with { type: "json" };
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
});
