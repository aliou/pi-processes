import { readFileSync } from "node:fs";

const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

export interface ProcessIdentityReader {
  bootId(): string | null;
  processStartTime(pid: number): string | null;
}

export function readBootId(): string | null {
  try {
    const value = readFileSync(BOOT_ID_PATH, "utf-8").trim();
    return value.length > 0 ? value : null;
  } catch (_error) {
    return null;
  }
}

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

export function readProcessStartTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    return startTimeFromStat(readFileSync(`/proc/${pid}/stat`, "utf-8"));
  } catch (_error) {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export const procfsIdentity: ProcessIdentityReader = {
  bootId: readBootId,
  processStartTime: readProcessStartTime,
};
