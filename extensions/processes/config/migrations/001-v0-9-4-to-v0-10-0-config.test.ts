import { describe, expect, it } from "vitest";

import { PROCESS_CONFIG_SCHEMA_URL } from "../schema";
import {
  type ConfigV094,
  configV094ToV0100Migration,
  migrateConfigV094ToV0100,
  needsConfigV094ToV0100Migration,
} from "./001-v0-9-4-to-v0-10-0-config";

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
      widget: { dockDefaultState: "closed", dockHeight: 9 },
    });
  });

  it("runs only for stale main-branch settings", () => {
    expect(
      needsConfigV094ToV0100Migration({
        $schema: PROCESS_CONFIG_SCHEMA_URL,
        widget: { dockDefaultState: "closed" },
      }),
    ).toBe(false);
    expect(needsConfigV094ToV0100Migration({})).toBe(false);
    expect(
      needsConfigV094ToV0100Migration({
        $schema: "https://example.com/old-schema.json",
      }),
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
    ).toBe(true);
  });

  it("exposes a ConfigLoader migration", async () => {
    const migrated = await configV094ToV0100Migration.run(
      { widget: { dockDefaultState: "hidden" as "closed" } },
      "/fake/path",
    );

    expect(migrated.widget?.dockDefaultState).toBe("closed");
    expect(migrated.$schema).toBe(PROCESS_CONFIG_SCHEMA_URL);
    expect(configV094ToV0100Migration.message).toContain("Migrated");
  });
});
