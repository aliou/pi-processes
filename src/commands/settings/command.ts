import { registerSettingsCommand } from "@aliou/pi-utils-settings";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessesConfig, ResolvedProcessesConfig } from "../../config";
import { configLoader } from "../../config";
import { applySettingChange } from "./apply-setting-change";
import { buildSettingsSections } from "./build-sections";

export function registerProcessesSettings(
  pi: ExtensionAPI,
  onSave?: () => void,
): void {
  registerSettingsCommand<ProcessesConfig, ResolvedProcessesConfig>(pi, {
    commandName: "ps:settings",
    title: "Processes Settings",
    configStore: configLoader,
    buildSections: buildSettingsSections,
    onSettingChange: applySettingChange,
    onSave,
  });
}
