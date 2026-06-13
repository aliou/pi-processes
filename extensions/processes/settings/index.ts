/**
 * Settings registration for the processes extension.
 *
 * Uses @aliou/pi-utils-settings infrastructure for a /ps:settings command
 * with Global/Local/Memory tabs and sectioned settings.
 */

import {
  registerSettingsCommand,
  type SettingsSection,
} from "@aliou/pi-utils-settings";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ProcessConfig, ProcessProtocolConfig } from "../config";
import { createSettingsConfigStore } from "../config";
import { applySettingChange } from "./apply-setting-change";
import { buildSections } from "./build-sections";

export function registerProcessSettings(pi: ExtensionAPI): void {
  const configStore = createSettingsConfigStore();

  registerSettingsCommand<ProcessConfig, ProcessProtocolConfig>(pi, {
    commandName: "ps:settings",
    title: "Processes Settings",
    configStore,
    buildSections: (
      tabConfig: ProcessConfig | null,
      resolved: ProcessProtocolConfig,
      ctx,
    ): SettingsSection[] => {
      return buildSections(tabConfig, resolved, {
        setDraft: ctx.setDraft,
        scope: ctx.scope,
        isInherited: ctx.isInherited,
        theme: ctx.theme,
      });
    },
    onSettingChange: (id, newValue, config) => {
      return applySettingChange(id, newValue, config);
    },
  });
}
