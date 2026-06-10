import {
  buildSchemaUrl,
  ConfigLoader,
  type ConfigStore,
  type Scope,
} from "@aliou/pi-utils-settings";
import pkg from "../../../package.json" with { type: "json" };
import { DEFAULT_CONFIG } from "./defaults";
import type { ProcessConfig, ResolvedProcessConfig } from "./types";

export const configLoader = new ConfigLoader<
  ProcessConfig,
  ResolvedProcessConfig
>("processes", DEFAULT_CONFIG, {
  scopes: ["global", "local", "memory"],
  schemaUrl: buildSchemaUrl(pkg.name, pkg.version),
});

export function createSettingsConfigStore(): ConfigStore<
  ProcessConfig,
  ResolvedProcessConfig
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
