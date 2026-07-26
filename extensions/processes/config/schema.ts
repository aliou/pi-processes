import { buildSchemaUrl } from "@aliou/pi-utils-settings";

import pkg from "../../../package.json" with { type: "json" };

export const PROCESS_CONFIG_SCHEMA_VERSION = pkg.version;
export const PROCESS_CONFIG_SCHEMA_URL = buildSchemaUrl(
  pkg.name,
  PROCESS_CONFIG_SCHEMA_VERSION,
);
