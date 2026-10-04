import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Reload the probe module, not the host process. No Pi runtime is loaded.
const require = createRequire(import.meta.url);
const { createJiti } = require("../../node_modules/.pnpm/node_modules/jiti");

export async function loadManager() {
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti.import(fileURLToPath(new URL("./manager.ts", import.meta.url)));
}
