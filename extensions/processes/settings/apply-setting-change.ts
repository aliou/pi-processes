/**
 * Apply a setting change to the config.
 *
 * Converts display values (e.g. "on"/"off") to storage types (booleans, numbers).
 * Returns the updated config, or null to fall through to default string storage.
 */

import { setNestedValue } from "@aliou/pi-utils-settings";

import type { ProcessConfig } from "../config";

const BOOLEAN_FIELDS = new Set(["interception.blockBackgroundCommands"]);

const TEXT_FIELDS = new Set(["execution.shellPath"]);

export function applySettingChange(
  id: string,
  newValue: string,
  config: ProcessConfig,
): ProcessConfig | null {
  const updated = structuredClone(config);

  if (BOOLEAN_FIELDS.has(id)) {
    setNestedValue(updated, id, newValue === "on");
    return updated;
  }

  if (TEXT_FIELDS.has(id)) {
    setNestedValue(updated, id, newValue === "(default)" ? "" : newValue);
    return updated;
  }

  // Unknown field: fall through to default string storage
  return null;
}
