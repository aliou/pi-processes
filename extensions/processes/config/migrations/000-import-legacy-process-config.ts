import { existsSync } from "node:fs";
import { constants, copyFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const { COPYFILE_EXCL } = constants;

/**
 * Config namespace used by pi-processes before 0.10.0.
 *
 * 0.9.4 shipped as the "process" extension, so its settings lived at
 * `~/.pi/agent/extensions/process.json`. The rewrite renamed the namespace
 * to "processes" (`processes.json`). ConfigLoader derives the file path
 * strictly from the extension name, with no alias or legacy support.
 */
const LEGACY_EXTENSION_NAME = "process";
const EXTENSION_NAME = "processes";

/**
 * Outcome of {@link importLegacyProcessConfig}.
 *
 * - `imported`: legacy file was copied to the current path. ConfigLoader should
 *   load the new file and run the `001` schema migration on real 0.9.4 data.
 * - `skipped`: nothing to import (no legacy file, or current file already
 *   exists). ConfigLoader proceeds normally.
 * - `invalid`: the legacy file exists but is not a readable JSON object. The
 *   copy is **not** performed, so ConfigLoader falls back to defaults instead
 *   of inheriting a corrupt config. The caller can surface a warning.
 */
export type LegacyImportResult =
  | { kind: "imported"; legacyPath: string }
  | { kind: "skipped" }
  | { kind: "invalid"; legacyPath: string; error: string };

/**
 * One-time import of the legacy 0.9.4 config file.
 *
 * Before `ConfigLoader.load()` runs, copy the legacy `process.json` to the
 * new `processes.json` if (and only if) the new file does not exist yet. The
 * subsequent `001` schema migration then runs on the real 0.9.4 data instead
 * of defaults.
 *
 * This cannot be a `Migration` array entry: `ConfigLoader.load()` only runs
 * migrations after a file is successfully read, and returns `null` for a
 * missing file. So a migration would never execute for the exact users it
 * targets (those who still only have `process.json`). The pre-load step
 * closes that gap.
 *
 * The legacy file is validated as a JSON object **before** copying. A corrupt
 * `process.json` is left untouched; importing it would make ConfigLoader's
 * `readFile` throw and silently fall back to defaults while a "settings
 * preserved" message is shown -- which would be actively misleading.
 *
 * The copy uses `COPYFILE_EXCL` so a concurrent import (e.g. two Pi instances
 * running in the same agent dir during an upgrade) cannot overwrite a
 * `processes.json` the other instance just created. The loser treats that as
 * "skipped".
 *
 * The legacy file is left in place as an accidental backup; it is ignored on
 * subsequent loads because `processes.json` now exists.
 *
 * 0.9.4 only used the global scope (`~/.pi/agent/extensions/`), so only the
 * global path is imported. No local-scope import is needed.
 */
export async function importLegacyProcessConfig(): Promise<LegacyImportResult> {
  const agentDir = getAgentDir();
  const legacyPath = resolve(
    agentDir,
    `extensions/${LEGACY_EXTENSION_NAME}.json`,
  );
  const currentPath = resolve(agentDir, `extensions/${EXTENSION_NAME}.json`);

  if (!existsSync(legacyPath)) return { kind: "skipped" };
  if (existsSync(currentPath)) return { kind: "skipped" };

  // Validate the legacy file before copying. A corrupt process.json would
  // make ConfigLoader.readFile throw and fall back to defaults; importing it
  // anyway would let us show a misleading "settings preserved" message.
  try {
    const raw = await readFile(legacyPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {
        kind: "invalid",
        legacyPath,
        error: "legacy config is not a JSON object",
      };
    }
  } catch (error) {
    return {
      kind: "invalid",
      legacyPath,
      error: (error as Error).message,
    };
  }

  // COPYFILE_EXCL makes the copy fail (EEXIST) if another instance created
  // processes.json between our existence check and the copy. Treat that as a
  // benign skip rather than a data-loss overwrite.
  try {
    await copyFile(legacyPath, currentPath, COPYFILE_EXCL);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "EEXIST") return { kind: "skipped" };
    throw error;
  }

  return { kind: "imported", legacyPath };
}
