import { ConfigLoader, type MigrationContext } from "@aliou/pi-utils-settings";
import { describe, expect, it } from "vitest";
import { migrations } from ".";

import {
  configVersionStampMigration,
  PROCESS_CONFIG_VERSION,
} from "./002-stamp-config-version";

const CTX: MigrationContext = {
  filePath: "/fake/processes.json",
  appliedMigrations: [],
  fromVersion: "0.0.0",
  toVersion: PROCESS_CONFIG_VERSION,
};

describe("002 stamp config version", () => {
  it("declares the current config version and no content gate", () => {
    expect(configVersionStampMigration.version).toBe(PROCESS_CONFIG_VERSION);
    expect(configVersionStampMigration.shouldRun).toBeUndefined();
  });

  it("leaves settings untouched", async () => {
    const config = { output: { maxOutputLines: 200 } };

    const migrated = await configVersionStampMigration.run(
      config,
      "/fake/processes.json",
      CTX,
    );

    expect(migrated).toEqual(config);
  });

  it("is registered after the shape migration", () => {
    expect(migrations.map((migration) => migration.name)).toEqual([
      "001-v0-9-4-to-v0-10-0-config",
      "002-stamp-config-version",
    ]);
  });

  it("keeps the semver version scheme the loader accepts", () => {
    expect(migrations.map((migration) => migration.version)).toEqual([
      "0.10.0",
      PROCESS_CONFIG_VERSION,
    ]);

    // The loader validates the scheme (semver only, strictly increasing).
    expect(
      () =>
        new ConfigLoader(
          "processes-migration-scheme-check",
          {},
          { scopes: ["global"], migrations },
        ),
    ).not.toThrow();
  });
});
