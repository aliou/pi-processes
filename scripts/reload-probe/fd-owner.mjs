import { existsSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadManager } from "./bootstrap.mjs";

// This process is the test subject: it models the entire Pi process, not a
// supervisor. The external observer never writes to or owns its FIFO handle.
const [cwd, fixture] = process.argv.slice(2);
const { ProbeManager } = await loadManager();
let manager = new ProbeManager();
manager.start(`exec bash ./${fixture}`, cwd, "fifo-fd");
const snapshot = manager.detach();
manager = null;
writeFileSync(join(cwd, "owner.json"), JSON.stringify(snapshot, null, 2));

// Deliberately no closeSync(), shutdown(), or exit cleanup handler. This tests
// OS cleanup, not application cleanup. The directory watcher keeps us alive.
watch(cwd, () => {
  if (existsSync(join(cwd, "exit-now"))) process.exit(0);
});
console.log(`OWNER_RECORD ${JSON.stringify(snapshot)}`);
