import type { MigrationContext } from "@aliou/pi-utils-settings";
import { describe, expect, it } from "vitest";
import type { ProcessConfig } from "../types";
import {
  configV106ToV140Migration,
  migrateConfigV106ToV140,
  needsConfigV106ToV140Migration,
} from "./003-v0-10-6-to-v0-14-0-config";

const CTX: MigrationContext = {
  filePath: "/fake/processes.json",
  appliedMigrations: [],
  fromVersion: "0.10.6",
  toVersion: "0.14.0",
};

describe("003 v0.10.6 to v0.14.0 config migration", () => {
  it("stores an explicit direct toolExposure when absent", () => {
    const config: ProcessConfig = {
      output: { maxOutputLines: 200 },
      follow: { enabledByDefault: false },
    };

    const migrated = migrateConfigV106ToV140(config);

    expect(migrated).toEqual({
      output: { maxOutputLines: 200 },
      follow: { enabledByDefault: false },
      toolExposure: "direct",
    });
  });

  it("keeps an existing toolExposure untouched", () => {
    const config: ProcessConfig = { toolExposure: "deferred" };

    expect(migrateConfigV106ToV140(config)).toBe(config);
    expect(needsConfigV106ToV140Migration(config)).toBe(false);
  });

  it("gates on content, not version", () => {
    expect(needsConfigV106ToV140Migration({})).toBe(true);
    expect(needsConfigV106ToV140Migration({ toolExposure: "direct" })).toBe(
      false,
    );
  });

  it("runs through the registered migration object", async () => {
    const config: ProcessConfig = { widget: { dockHeight: 9 } };

    const migrated = await configV106ToV140Migration.run(
      config,
      "/fake/processes.json",
      CTX,
    );

    expect(migrated).toEqual({
      widget: { dockHeight: 9 },
      toolExposure: "direct",
    });
    expect(configV106ToV140Migration.shouldRun?.({}, CTX)).toBe(true);
    expect(configV106ToV140Migration.version).toBeUndefined();
  });
});
