import { buildSchemaUrl } from "@aliou/pi-utils-settings";

import pkg from "../../../package.json" with { type: "json" };

export const PROCESS_CONFIG_SCHEMA_VERSION = "0.11.0";
export const PROCESS_CONFIG_SCHEMA_URL = buildSchemaUrl(
  pkg.name,
  PROCESS_CONFIG_SCHEMA_VERSION,
);
