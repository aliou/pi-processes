/**
 * Settings registration for the codex-unified-exec extension.
 *
 * Mirrors the processes extension's ps:settings pattern: a /codex-exec:settings
 * command with Global/Local/Memory tabs and sectioned settings.
 */

import {
  registerSettingsCommand,
  type SettingsSection,
} from "@aliou/pi-utils-settings";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { CodexExecConfig, CodexExecProtocolConfig } from "../config";
import { createSettingsConfigStore } from "../config";
import { applySettingChange } from "./apply-setting-change";
import { buildSections } from "./build-sections";

export function registerCodexExecSettings(pi: ExtensionAPI): void {
  const configStore = createSettingsConfigStore();

  registerSettingsCommand<CodexExecConfig, CodexExecProtocolConfig>(pi, {
    commandName: "codex-exec:settings",
    title: "Codex Exec Settings",
    configStore,
    buildSections: (
      tabConfig: CodexExecConfig | null,
      resolved: CodexExecProtocolConfig,
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
