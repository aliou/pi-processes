import type { Migration } from "@aliou/pi-utils-settings";

import type { ProcessConfig } from "../types";

export const PROCESS_CONFIG_VERSION = "0.10.0";

export function needsConfigVersionStamp(config: ProcessConfig): boolean {
  return (config.version ?? "") < PROCESS_CONFIG_VERSION;
}

export function stampConfigVersion(config: ProcessConfig): ProcessConfig {
  return { ...config, version: PROCESS_CONFIG_VERSION };
}

export const configVersionStampMigration: Migration<ProcessConfig> = {
  name: "002-stamp-v0-10-0-config-version",
  shouldRun: needsConfigVersionStamp,
  run: (config) => stampConfigVersion(config),
  message:
    "Updated pi-processes settings for v0.10.0. This release rewrites the package into separate process, logs, and dock extensions while preserving your existing settings. Release notes will be published at https://github.com/aliou/pi-processes/releases/tag/v0.10.0.",
};
