import {
  ConfigLoader,
  type ConfigStore,
  type Scope,
} from "@aliou/pi-utils-settings";
import { DEFAULT_CONFIG } from "./defaults";
import { migrations } from "./migrations";
import { PROCESS_CONFIG_SCHEMA_URL } from "./schema";
import type { ProcessConfig, ProcessProtocolConfig } from "./types";

export async function loadProcessConfig(): Promise<void> {
  await configLoader.load();
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
