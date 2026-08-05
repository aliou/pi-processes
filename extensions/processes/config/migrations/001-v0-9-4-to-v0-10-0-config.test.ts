import type { MigrationContext } from "@aliou/pi-utils-settings";
import { describe, expect, it } from "vitest";
import { PROCESS_CONFIG_SCHEMA_URL } from "../schema";
import type { ProcessConfig } from "../types";
import {
  type ConfigV094,
  configV094ToV0100Migration,
  migrateConfigV094ToV0100,
  needsConfigV094ToV0100Migration,
} from "./001-v0-9-4-to-v0-10-0-config";

const CTX: MigrationContext = {
  filePath: "/fake/path",
  appliedMigrations: [],
  fromVersion: "0.0.0",
  toVersion: "0.10.0",
};

describe("001 v0.9.4 to v0.10.0 config migration", () => {
  it("normalizes stale v0.9.4 settings", () => {
    const migrated = migrateConfigV094ToV0100({
      $schema: "https://example.com/old-schema.json",
      processList: { maxVisibleProcesses: 8, maxPreviewLines: 12 },
      output: { defaultTailLines: 100, maxOutputLines: 200 },
      execution: { shellPath: "/bin/zsh" },
      interception: { blockBackgroundCommands: false },
      follow: { enabledByDefault: true, autoHideOnFinish: true },
      widget: {
        showStatusWidget: true,
        dockDefaultState: "hidden",
        dockHeight: 9,
      },
      keybindings: { killProcess: "x" },
    } satisfies ConfigV094);

    expect(migrated).toEqual({
      $schema: PROCESS_CONFIG_SCHEMA_URL,
      processList: { maxVisibleProcesses: 8, maxPreviewLines: 12 },
      output: { defaultTailLines: 100, maxOutputLines: 200 },
      execution: { shellPath: "/bin/zsh" },
      interception: { blockBackgroundCommands: false },
      follow: { enabledByDefault: true, autoHideOnFinish: true },
      widget: {
        showStatusWidget: true,
        dockDefaultState: "closed",
        dockHeight: 9,
      },
    });
  });

  it("runs only for stale main-branch settings", () => {
    expect(
      needsConfigV094ToV0100Migration({
        $schema: PROCESS_CONFIG_SCHEMA_URL,
        widget: { dockDefaultState: "closed" },
      } as ProcessConfig),
    ).toBe(false);
    expect(needsConfigV094ToV0100Migration({})).toBe(false);
    expect(
      needsConfigV094ToV0100Migration({
        $schema: "https://example.com/old-schema.json",
      } as ProcessConfig),
    ).toBe(false);
    expect(
      needsConfigV094ToV0100Migration({
        widget: { dockDefaultState: "hidden" as "closed" },
      }),
    ).toBe(true);
    expect(
      needsConfigV094ToV0100Migration({
        widget: { showStatusWidget: false } as unknown as never,
      }),
    ).toBe(false);
    expect(
      needsConfigV094ToV0100Migration({
        widget: {
          showStatusWidget: true,
          dockDefaultState: "hidden" as "closed",
        } as unknown as never,
      }),
    ).toBe(true);
  });

  it("exposes a ConfigLoader migration", async () => {
    const migrated = await configV094ToV0100Migration.run(
      { widget: { dockDefaultState: "hidden" as "closed" } },
      "/fake/path",
      CTX,
    );

    expect(migrated.widget?.dockDefaultState).toBe("closed");
    expect((migrated as { $schema?: string }).$schema).toBe(
      PROCESS_CONFIG_SCHEMA_URL,
    );
    expect(configV094ToV0100Migration.message).toContain("Migrated");
  });

  it("declares the v0.10.0 config version", () => {
    expect(configV094ToV0100Migration.version).toBe("0.10.0");
  });

  it("skips configs already stamped v0.10.0 or newer", () => {
    const stale = { widget: { dockDefaultState: "hidden" as "closed" } };

    expect(needsConfigV094ToV0100Migration(stale, "0.0.0")).toBe(true);
    expect(needsConfigV094ToV0100Migration(stale, "0.9.4")).toBe(true);
    expect(needsConfigV094ToV0100Migration(stale, "0.10.0")).toBe(false);
    expect(needsConfigV094ToV0100Migration(stale, "0.10.5")).toBe(false);
    expect(needsConfigV094ToV0100Migration(stale, "1.0.0")).toBe(false);

    expect(
      configV094ToV0100Migration.shouldRun?.(stale, {
        ...CTX,
        fromVersion: "0.10.5",
      }),
    ).toBe(false);
    expect(configV094ToV0100Migration.shouldRun?.(stale, CTX)).toBe(true);
  });
});
