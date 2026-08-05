import type { Migration } from "@aliou/pi-utils-settings";

import type { ProcessConfig } from "../types";

/**
 * Current config version stamped on every settings file.
 *
 * Keep this in sync with the `--version` flag of the `gen:schema` and
 * `check:schema` scripts in package.json.
 */
export const PROCESS_CONFIG_VERSION = "0.10.6";

/**
 * Terminal migration: converge every config on the current version.
 *
 * The config is left untouched; the loader stamps `version` after the run.
 * Configs stamped by earlier migrations (or already current) are skipped by
 * the default version comparison.
 */
export const configVersionStampMigration: Migration<ProcessConfig> = {
  name: "002-stamp-config-version",
  version: PROCESS_CONFIG_VERSION,
  run: (config) => config,
};
