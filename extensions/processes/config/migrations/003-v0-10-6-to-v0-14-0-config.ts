import type { Migration } from "@aliou/pi-utils-settings";

import type { ProcessConfig } from "../types";

export function needsConfigV106ToV140Migration(config: ProcessConfig): boolean {
  return config.toolExposure === undefined;
}

export function migrateConfigV106ToV140(config: ProcessConfig): ProcessConfig {
  if (config.toolExposure !== undefined) return config;
  return { ...config, toolExposure: "direct" };
}

export const configV106ToV140Migration: Migration<ProcessConfig> = {
  name: "003-v0-10-6-to-v0-14-0-config",
  shouldRun: (config) => needsConfigV106ToV140Migration(config),
  run: (config) => migrateConfigV106ToV140(config),
  message:
    "Stored an explicit toolExposure of direct in pi-processes settings.",
};
