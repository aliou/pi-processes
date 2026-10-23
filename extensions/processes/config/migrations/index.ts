import type { Migration } from "@aliou/pi-utils-settings";

import type { ProcessConfig } from "../types";
import { configV094ToV0100Migration } from "./001-v0-9-4-to-v0-10-0-config";
import { configVersionStampMigration } from "./002-stamp-config-version";
import { configV106ToV140Migration } from "./003-v0-10-6-to-v0-14-0-config";

export { importLegacyProcessConfig } from "./000-import-legacy-process-config";
export {
  type ConfigV094,
  type ConfigV0100,
  configV094ToV0100Migration,
  migrateConfigV094ToV0100,
  needsConfigV094ToV0100Migration,
} from "./001-v0-9-4-to-v0-10-0-config";
export {
  configVersionStampMigration,
  PROCESS_CONFIG_VERSION,
} from "./002-stamp-config-version";
export {
  configV106ToV140Migration,
  migrateConfigV106ToV140,
  needsConfigV106ToV140Migration,
} from "./003-v0-10-6-to-v0-14-0-config";

export const migrations: Migration<ProcessConfig>[] = [
  configV094ToV0100Migration,
  configV106ToV140Migration,
  configVersionStampMigration,
];
