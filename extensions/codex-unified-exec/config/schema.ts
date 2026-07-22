import { buildSchemaUrl } from "@aliou/pi-utils-settings";

import pkg from "../../../package.json" with { type: "json" };

export const CODEX_EXEC_CONFIG_SCHEMA_VERSION = "0.10.0";
export const CODEX_EXEC_CONFIG_SCHEMA_URL = buildSchemaUrl(
  pkg.name,
  CODEX_EXEC_CONFIG_SCHEMA_VERSION,
);
