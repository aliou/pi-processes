import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as baseTest } from "vitest";

type AddFile = (name: string, content?: string) => void;
type AddScript = (name: string) => void;

const scriptFixtureDir = fileURLToPath(new URL("./scripts", import.meta.url));

const testWithCwd = baseTest.extend("cwd", ({ task }, { onCleanup }) => {
  const safeName = task.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  const cwd = mkdtempSync(join(tmpdir(), `manager-e2e-${safeName}-`));

  onCleanup(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  return cwd;
});

export const test = testWithCwd.extend<{
  addFile: AddFile;
  addScript: AddScript;
}>({
  addFile: async ({ cwd }, use) => {
    await use((name, content = "") => {
      writeFileSync(join(cwd, name), content);
    });
  },
  addScript: async ({ cwd }, use) => {
    await use((name) => {
      const source = join(scriptFixtureDir, name);
      const destination = join(cwd, name);

      copyFileSync(source, destination);
      chmodSync(destination, statSync(source).mode);
    });
  },
});
