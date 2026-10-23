/**
 * Apply a setting change to the core processes config.
 *
 * Logs/overview/dock settings are handled by their owning extensions.
 */

import { setNestedValue } from "@aliou/pi-utils-settings";

import { type ProcessConfig, TOOL_EXPOSURES } from "../config";

const BOOLEAN_FIELDS = new Set([
  "interception.blockBackgroundCommands",
  "widget.showStatusWidget",
]);

const ENUM_FIELDS = new Map<string, readonly string[]>([
  ["toolExposure", TOOL_EXPOSURES],
]);

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

  const enumValues = ENUM_FIELDS.get(id);
  if (enumValues) {
    if (!enumValues.includes(newValue)) return null;
    setNestedValue(updated, id, newValue);
    return updated;
  }

  // Unknown field: fall through to default string storage
  return null;
}
