import { describe, expect, it } from "vitest";
import { migrations } from ".";

import {
  configVersionStampMigration,
  needsConfigVersionStamp,
  PROCESS_CONFIG_VERSION,
  stampConfigVersion,
} from "./002-stamp-v0-10-0-config-version";

describe("002 stamp v0.10.0 config version", () => {
  it("runs when the config has no version", () => {
    expect(needsConfigVersionStamp({})).toBe(true);
    expect(needsConfigVersionStamp({ version: undefined })).toBe(true);
  });

  it("runs when the config version is older than v0.10.0", () => {
    expect(needsConfigVersionStamp({ version: "0.0.0" })).toBe(true);
  });

  it("does not run when the config version is v0.10.0 or newer", () => {
    expect(needsConfigVersionStamp({ version: "0.10.0" })).toBe(false);
    expect(needsConfigVersionStamp({ version: "0.10.1" })).toBe(false);
  });

  it("writes the v0.10.0 version while preserving settings", () => {
    expect(
      stampConfigVersion({
        output: { maxOutputLines: 200 },
        widget: { showStatusWidget: true },
      }),
    ).toEqual({
      version: PROCESS_CONFIG_VERSION,
      output: { maxOutputLines: 200 },
      widget: { showStatusWidget: true },
    });
  });

  it("exposes a ConfigLoader migration", async () => {
    const migrated = await configVersionStampMigration.run(
      { output: { maxOutputLines: 200 } },
      "/fake/processes.json",
    );

    expect(migrated).toEqual({
      version: PROCESS_CONFIG_VERSION,
      output: { maxOutputLines: 200 },
    });
    expect(configVersionStampMigration.shouldRun(migrated)).toBe(false);
    expect(configVersionStampMigration.message).toContain("v0.10.0");
    expect(configVersionStampMigration.message).toContain(
      "https://github.com/aliou/pi-processes/releases/tag/v0.10.0",
    );
  });

  it("is registered after the shape migration", () => {
    expect(migrations.map((migration) => migration.name)).toEqual([
      "001-v0-9-4-to-v0-10-0-config",
      "002-stamp-v0-10-0-config-version",
    ]);
  });
});
