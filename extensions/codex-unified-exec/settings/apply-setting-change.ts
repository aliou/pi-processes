/**
 * Apply a setting change to the codex-unified-exec config.
 *
 * The Core toggle (`enabled`) is handled here. The Advanced detail-editor
 * fields (session/output caps) sync the draft directly via setDraft, so they
 * do not flow through this function.
 */

import type { CodexExecConfig } from "../config";

export function applySettingChange(
  id: string,
  newValue: string,
  config: CodexExecConfig,
): CodexExecConfig | null {
  if (id === "enabled") {
    const updated = structuredClone(config);
    updated.enabled = newValue === "on";
    return updated;
  }
  return null;
}
