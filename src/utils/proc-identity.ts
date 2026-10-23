/**
 * Process identity via Linux procfs.
 *
 * A bare PID is not a stable identity: PIDs are recycled. `/proc/PID/stat`
 * field 22 (`starttime`, clock ticks since boot) plus the kernel boot ID
 * (`/proc/sys/kernel/random/boot_id`) together identify one specific process
 * instance across the current boot. Comparing them before signaling a PID
 * recorded in a previous session prevents killing an unrelated process that
 * reused the PID.
 *
 * Non-Linux platforms (macOS) have no procfs; the readers return `null` there
 * and orphan recovery stays disabled rather than falling back to a PID-only
 * check that could kill a reused PID.
 */
import { readFileSync } from "node:fs";

const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

/** Identity readers used by orphan recovery. Injectable for tests. */
export interface ProcessIdentityReader {
  /** Kernel boot ID, or null when unavailable (non-Linux). */
  bootId(): string | null;
  /** `/proc/PID/stat` starttime (field 22) as a decimal string, or null. */
  processStartTime(pid: number): string | null;
}

/** Read the kernel boot ID (`/proc/sys/kernel/random/boot_id`). */
export function readBootId(): string | null {
  try {
    const value = readFileSync(BOOT_ID_PATH, "utf-8").trim();
    return value.length > 0 ? value : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Extract the starttime field from a `/proc/PID/stat` contents string.
 *
 * Field 2 (`comm`) is parenthesized and may contain spaces and parentheses,
 * so parsing starts after the last `)`. starttime is field 22; after dropping
 * fields 1 and 2, that is index 19 of the remaining space-separated fields.
 */
export function startTimeFromStat(stat: string): string | null {
  const closeParen = stat.lastIndexOf(")");
  if (closeParen === -1) return null;

  const fields = stat
    .slice(closeParen + 1)
    .trim()
    .split(/\s+/);
  const starttime = fields[19];
  return starttime && /^\d+$/u.test(starttime) ? starttime : null;
}

/** Read the starttime of a live process, or null if it cannot be read. */
export function readProcessStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    return startTimeFromStat(readFileSync(`/proc/${pid}/stat`, "utf-8"));
  } catch (_error) {
    return null;
  }
}

/** Check whether a PID is alive using signal 0 (EPERM counts as alive). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Default procfs-backed identity reader. */
export const procfsIdentity: ProcessIdentityReader = {
  bootId: readBootId,
  processStartTime: readProcessStartTime,
};
