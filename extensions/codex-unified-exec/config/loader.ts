import {
  ConfigLoader,
  type ConfigStore,
  type Migration,
  type Scope,
} from "@aliou/pi-utils-settings";

import { DEFAULT_CONFIG } from "./defaults";
import { CODEX_EXEC_CONFIG_SCHEMA_URL } from "./schema";
import type { CodexExecConfig, CodexExecProtocolConfig } from "./types";

/**
 * A brand-new extension: there are no legacy config versions to migrate, so the
 * migrations array is empty. The array is kept (and typed) so a future migration
 * can be appended without touching the loader shape.
 */
export const configLoader = new ConfigLoader<
  CodexExecConfig,
  CodexExecProtocolConfig
>("codex-unified-exec", DEFAULT_CONFIG, {
  scopes: ["global", "local", "memory"],
  migrations: [] as Migration<CodexExecConfig>[],
  schemaUrl: CODEX_EXEC_CONFIG_SCHEMA_URL,
});

export async function loadCodexExecConfig(): Promise<void> {
  await configLoader.load();
}

export function createSettingsConfigStore(): ConfigStore<
  CodexExecConfig,
  CodexExecProtocolConfig
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
