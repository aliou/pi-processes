import {
  ConfigLoader,
  type ConfigStore,
  type Scope,
} from "@aliou/pi-utils-settings";
import { DEFAULT_CONFIG } from "./defaults";
import { importLegacyProcessConfig, migrations } from "./migrations";
import { PROCESS_CONFIG_SCHEMA_URL } from "./schema";
import type { ProcessConfig, ProcessProtocolConfig } from "./types";

/**
 * Pending messages from the one-time legacy config import. Drained alongside
 * ConfigLoader migration messages in registerMigrationMessageNotifications.
 */
const importMessages: string[] = [];

export async function loadProcessConfig(): Promise<void> {
  const result = await importLegacyProcessConfig();
  if (result.kind === "imported") {
    importMessages.push(
      `Imported pi-processes settings from the legacy 0.9.4 config file at ${result.legacyPath}. Your existing settings were preserved and migrated to the current schema.`,
    );
  } else if (result.kind === "invalid") {
    importMessages.push(
      `Found a legacy 0.9.4 config file at ${result.legacyPath}, but it is not a readable JSON object (${result.error}). It was left in place and the current settings were loaded from defaults instead.`,
    );
  }
  await configLoader.load();
}

/** Drain (remove and return) all pending legacy-import messages. */
export function drainImportMessages(): string[] {
  return importMessages.splice(0);
}

export const configLoader = new ConfigLoader<
  ProcessConfig,
  ProcessProtocolConfig
>("processes", DEFAULT_CONFIG, {
  scopes: ["global", "local", "memory"],
  migrations,
  schemaUrl: PROCESS_CONFIG_SCHEMA_URL,
});

export function createSettingsConfigStore(): ConfigStore<
  ProcessConfig,
  ProcessProtocolConfig
> {
  return {
    save: (scope, config) => configLoader.save(scope, config),
    getConfig: () => configLoader.getConfig(),
    getRawConfig: (scope) => configLoader.getRawConfig(scope),
    hasScope: (scope) => configLoader.hasScope(scope),
    hasConfig: (scope) => configLoader.hasConfig(scope),
    getEnabledScopes: () => {
      const enabled = new Set(configLoader.getEnabledScopes());
      return (["global", "local", "memory"] as Scope[]).filter((scope) =>
        enabled.has(scope),
      );
    },
  };
}
