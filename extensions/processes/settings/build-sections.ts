/**
 * Build settings sections for the processes extension.
 *
 * Each section maps to a top-level config group.
 * Values show the scope-local override or the inherited resolved value.
 */

import type { Scope, SettingsSection } from "@aliou/pi-utils-settings";
import type { SettingItem } from "@earendil-works/pi-tui";

import type { ProcessConfig, ResolvedProcessConfig } from "../config";

interface BuildSectionsContext {
  setDraft: (config: ProcessConfig) => void;
  scope: Scope;
  isInherited: (path: string) => boolean;
}

export function buildSections(
  tabConfig: ProcessConfig | null,
  resolved: ResolvedProcessConfig,
  _ctx: BuildSectionsContext,
): SettingsSection[] {
  const scopedConfig = structuredClone(tabConfig ?? {}) as ProcessConfig;

  function boolItem(
    id: string,
    label: string,
    description: string,
    scopedValue: boolean | undefined,
    resolvedValue: boolean,
  ): SettingItem {
    const display =
      scopedValue === undefined
        ? `inherited: ${resolvedValue ? "on" : "off"}`
        : scopedValue
          ? "on"
          : "off";
    return {
      id,
      label,
      description,
      currentValue: display,
      values: ["on", "off"],
    };
  }

  function textItem(
    id: string,
    label: string,
    description: string,
    scopedValue: string | undefined,
    resolvedValue: string | undefined,
    emptyText: string,
  ): SettingItem {
    const display =
      scopedValue === undefined
        ? resolvedValue === undefined
          ? emptyText
          : `inherited: ${resolvedValue || emptyText}`
        : scopedValue || emptyText;
    return {
      id,
      label,
      description,
      currentValue: display,
    };
  }

  const executionSection: SettingsSection = {
    label: "Execution",
    items: [
      textItem(
        "execution.shellPath",
        "Shell path",
        "Path to the shell executable for process commands. Leave empty to use the system default.",
        scopedConfig.execution?.shellPath,
        resolved.execution.shellPath,
        "(default)",
      ),
    ],
  };

  const interceptionSection: SettingsSection = {
    label: "Interception",
    items: [
      boolItem(
        "interception.blockBackgroundCommands",
        "Block background commands",
        "Block shell background patterns (&, nohup, disown, setsid) in bash tool calls. Redirects to the process tool instead.",
        scopedConfig.interception?.blockBackgroundCommands,
        resolved.interception.blockBackgroundCommands,
      ),
    ],
  };

  return [executionSection, interceptionSection];
}
