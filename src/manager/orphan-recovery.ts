/**
 * Orphaned-process recovery for abnormally killed pi sessions.
 *
 * When pi exits gracefully, the `session_shutdown` hook kills every managed
 * process group. When pi is SIGKILLed (or OOM-killed), no handler runs: the
 * detached process groups survive, are re-parented to PID 1, and no later
 * session knows about them because manager state is in-memory only.
 *
 * This module closes that gap with a minimal persisted record per started
 * process, written outside the temporary log directory:
 *
 * - On `start`/`adopt`, `ProcessRuntimeController` writes a record holding
 *   the child PID (= process-group ID), its `/proc/PID/stat` starttime, the
 *   kernel boot ID, and the identity (PID + starttime) of the pi host that
 *   owns it.
 * - When a process ends, or the manager cleans up at graceful shutdown, the
 *   record is removed.
 * - On the next session start, `reapOrphanedRecords` walks the persisted
 *   records and kills the process groups whose owning pi host is verifiably
 *   dead. Liveness is verified with starttime + boot ID so a reused PID is
 *   never signaled.
 *
 * Records are only written when procfs identity is available (Linux); on
 * other POSIX platforms recovery stays disabled rather than risking a kill
 * of a PID-reused group.
 */
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { ProcessIdentityReader } from "../utils/proc-identity";

export const ORPHAN_RECORD_VERSION = 1;

/** Temp record files older than this are pruned during a reap. */
export const STRAY_TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Persisted identity of one managed process group.
 *
 * `pid` is the group leader spawned by `spawnCommand` (detached: leader,
 * session, and group share the PID). `startTimeTicks` is `/proc/PID/stat`
 * field 22; `hostPid`/`hostStartTimeTicks` identify the pi process that owns
 * the record, so a concurrent live session's records are never reaped.
 */
export interface OrphanProcessRecord {
  version: typeof ORPHAN_RECORD_VERSION;
  id: string;
  name: string;
  command: string;
  cwd: string;
  pid: number;
  startTimeTicks: string;
  bootId: string;
  hostPid: number;
  hostStartTimeTicks: string;
  logDir: string;
  recordedAt: number;
}

/** The pi host that owns an orphan-record store. */
export interface HostIdentity {
  bootId: string;
  pid: number;
  startTimeTicks: string;
}

/** A reaped (killed) orphan summary, safe to report to the UI. */
export interface ReapedOrphanSummary {
  id: string;
  name: string;
  command: string;
  pid: number;
}

/** Why a record was discarded without killing its process group. */
export type DiscardedOrphanReason =
  | "rebooted" // record predates the current boot; nothing can be alive
  | "pid_reused" // PID now belongs to a different process; never signal it
  | "leader_gone" // group leader exited; no identity anchor for a kill
  | "already_dead" // the group died on its own before or during the reap
  | "kill_failed"; // signaling failed (e.g. EPERM); reported, loop continues

export interface OrphanReapReport {
  /** Orphaned groups that were verified and killed. */
  killed: ReapedOrphanSummary[];
  /** Records removed without a kill. */
  discarded: Array<{ id: string; name: string; reason: DiscardedOrphanReason }>;
  /** Records kept because their owning pi session is still alive. */
  kept: number;
}

/** OS-facing operations used by the reap decision. Injectable for tests. */
export interface OrphanReapDeps {
  identity: ProcessIdentityReader;
  isPidAlive(pid: number): boolean;
  isGroupAlive(pgid: number): boolean;
  killGroup(pgid: number): void;
  removeLogDir(dir: string): void;
}

function recordFileName(record: { hostPid: number; id: string }): string {
  return `${record.hostPid}-${record.id}.json`;
}

function isValidRecord(value: unknown): value is OrphanProcessRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === ORPHAN_RECORD_VERSION &&
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.command === "string" &&
    typeof record.cwd === "string" &&
    typeof record.pid === "number" &&
    Number.isInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.startTimeTicks === "string" &&
    typeof record.bootId === "string" &&
    typeof record.hostPid === "number" &&
    Number.isInteger(record.hostPid) &&
    record.hostPid > 0 &&
    typeof record.hostStartTimeTicks === "string" &&
    typeof record.logDir === "string" &&
    typeof record.recordedAt === "number"
  );
}

/**
 * Filesystem store for orphan records.
 *
 * One JSON file per record under `dir`, written atomically (temp file +
 * rename) so a concurrently reaping session never reads a partial record.
 * The store tracks the files this instance wrote so `removeWritten()` can
 * clear exactly this manager's records at graceful shutdown without touching
 * records belonging to concurrent pi sessions sharing the directory.
 *
 * All record I/O is best-effort: recovery must never break the core start,
 * end, or shutdown paths, so a failing write degrades to "no record" and a
 * failing remove is ignored rather than thrown.
 */
export class OrphanRecordStore {
  private readonly dir: string;
  private readonly written = new Set<string>();

  constructor(dir: string) {
    this.dir = dir;
  }

  write(record: OrphanProcessRecord): void {
    const file = join(this.dir, recordFileName(record));
    // A unique temp name per write so a crash between write and rename never
    // clobbers another in-flight write; strays are pruned by list().
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
      renameSync(tmp, file);
      this.written.add(file);
    } catch (_error) {
      try {
        rmSync(tmp, { force: true });
      } catch (_cleanupError) {
        void _cleanupError; // Best-effort temp cleanup; strays are pruned later
      }
    }
  }

  remove(record: { hostPid: number; id: string }): void {
    const file = join(this.dir, recordFileName(record));
    this.written.delete(file);
    try {
      rmSync(file, { force: true });
    } catch (_error) {
      void _error; // Intentionally ignored - best-effort record removal
    }
  }

  /** Remove every record this store instance wrote (graceful shutdown). */
  removeWritten(): void {
    const files = [...this.written];
    this.written.clear();
    for (const file of files) {
      try {
        rmSync(file, { force: true });
      } catch (_error) {
        void _error; // Intentionally ignored - best-effort record removal
      }
    }
  }

  /**
   * List persisted records.
   *
   * Unreadable or corrupt files (a crash mid-write) are removed: a record
   * nobody can verify must never authorize a kill. Records with a *newer*
   * format version are skipped but kept — they belong to a newer
   * pi-processes session that may still be running. Temp files left by an
   * interrupted write are pruned once they are older than
   * STRAY_TEMP_FILE_MAX_AGE_MS, so an in-flight write from a concurrent
   * session is never touched.
   */
  list(): OrphanProcessRecord[] {
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch (_error) {
      return [];
    }

    const records: OrphanProcessRecord[] = [];
    for (const entry of entries) {
      if (entry.endsWith(".tmp")) {
        this.pruneTempFile(join(this.dir, entry));
        continue;
      }
      if (!entry.endsWith(".json")) continue;
      const file = join(this.dir, entry);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, "utf-8"));
      } catch (_error) {
        this.removeFile(file);
        continue;
      }
      if (isValidRecord(parsed)) {
        records.push(parsed);
        continue;
      }
      const version = (parsed as Record<string, unknown>).version;
      if (typeof version === "number" && version > ORPHAN_RECORD_VERSION) {
        // Newer format: keep it for the newer session that wrote it.
        continue;
      }
      this.removeFile(file);
    }
    return records;
  }

  private removeFile(file: string): void {
    try {
      rmSync(file, { force: true });
    } catch (_error) {
      void _error; // Intentionally ignored - best-effort record removal
    }
  }

  private pruneTempFile(file: string): void {
    try {
      const mtimeMs = statSync(file).mtimeMs;
      if (Date.now() - mtimeMs < STRAY_TEMP_FILE_MAX_AGE_MS) return;
    } catch (_error) {
      return; // Unstatatable: leave it alone
    }
    this.removeFile(file);
  }
}

/**
 * Decide whether the record's owning pi host is still alive.
 *
 * Returns true when in doubt (PID alive but stat unreadable): killing
 * another live session's processes is the failure mode this check exists to
 * prevent. A PID that is gone, or reused by a process with a different
 * starttime, is verifiably dead.
 */
function isHostAlive(
  record: OrphanProcessRecord,
  deps: OrphanReapDeps,
): boolean {
  if (!deps.isPidAlive(record.hostPid)) return false;
  const hostStart = deps.identity.processStartTime(record.hostPid);
  if (hostStart === null) return true;
  return hostStart === record.hostStartTimeTicks;
}

/**
 * Reap orphaned process groups left by pi sessions that died without
 * running the `session_shutdown` hook (SIGKILL, OOM kill).
 *
 * For each persisted record:
 *
 * - Different boot ID: the host and child cannot exist; discard the record.
 * - Host alive (same PID + starttime): a concurrent pi session owns it;
 *   keep the record untouched.
 * - Host dead: verify the child's identity via starttime. Only a matching,
 *   still-alive group is killed (SIGKILL to `-pgid`). A reused PID or an
 *   unverifiable identity is never signaled; the record is discarded.
 *
 * A kill that raises ESRCH (the group died mid-reap, or another session won
 * a race on the same record) is reported as `already_dead`; any other kill
 * failure (e.g. EPERM) is reported as `kill_failed`. Neither aborts the
 * loop.
 *
 * Leftover log directories of dead hosts are removed along with their
 * records.
 */
export function reapOrphanedRecords(
  store: OrphanRecordStore,
  deps: OrphanReapDeps,
): OrphanReapReport {
  const report: OrphanReapReport = { killed: [], discarded: [], kept: 0 };

  const bootId = deps.identity.bootId();
  if (bootId === null) return report;

  for (const record of store.list()) {
    if (record.bootId !== bootId) {
      store.remove(record);
      deps.removeLogDir(record.logDir);
      report.discarded.push({
        id: record.id,
        name: record.name,
        reason: "rebooted",
      });
      continue;
    }

    if (isHostAlive(record, deps)) {
      report.kept++;
      continue;
    }

    const childStart = deps.identity.processStartTime(record.pid);
    if (childStart === null) {
      // The leader's /proc entry is gone. The group may still hold
      // stragglers, but with no identity anchor a group kill could hit a
      // reused PID, so the group is left alone and the record discarded.
      store.remove(record);
      deps.removeLogDir(record.logDir);
      report.discarded.push({
        id: record.id,
        name: record.name,
        reason: "leader_gone",
      });
      continue;
    }

    if (childStart !== record.startTimeTicks) {
      store.remove(record);
      deps.removeLogDir(record.logDir);
      report.discarded.push({
        id: record.id,
        name: record.name,
        reason: "pid_reused",
      });
      continue;
    }

    store.remove(record);
    if (deps.isGroupAlive(record.pid)) {
      try {
        deps.killGroup(record.pid);
        report.killed.push({
          id: record.id,
          name: record.name,
          command: record.command,
          pid: record.pid,
        });
      } catch (error) {
        // The group died between the liveness check and the signal (also
        // the normal outcome when two sessions race on the same record), or
        // the signal was refused. Either way the record is gone and the
        // reap continues with the remaining records.
        const err = error as NodeJS.ErrnoException;
        report.discarded.push({
          id: record.id,
          name: record.name,
          reason: err.code === "ESRCH" ? "already_dead" : "kill_failed",
        });
      }
    } else {
      report.discarded.push({
        id: record.id,
        name: record.name,
        reason: "already_dead",
      });
    }
    deps.removeLogDir(record.logDir);
  }

  return report;
}

/**
 * Remove a dead host's leftover log directory.
 *
 * Only directories our own `ProcessLogStore` created via `mkdtemp`
 * (`pi-processes-*` directly under the temp dir) are removed; anything else
 * — including an explicitly configured log directory that happens to carry
 * the prefix — is left in place.
 */
export function removeOrphanLogDir(dir: string): void {
  if (dirname(dir) !== tmpdir()) return;
  if (!basename(dir).startsWith("pi-processes-")) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_error) {
    void _error; // Intentionally ignored - best-effort leftover cleanup
  }
}

/**
 * Build the persisted orphan record for a newly started process.
 *
 * `childStartTimeTicks` must have been read from `/proc/PID/stat`; callers
 * skip persistence when it is unavailable (a record without a verifiable
 * starttime would never authorize a kill).
 */
export function buildOrphanRecord(
  host: HostIdentity,
  process: {
    id: string;
    name: string;
    command: string;
    cwd: string;
    pid: number;
  },
  logDir: string,
  childStartTimeTicks: string,
): OrphanProcessRecord {
  return {
    version: ORPHAN_RECORD_VERSION,
    id: process.id,
    name: process.name,
    command: process.command,
    cwd: process.cwd,
    pid: process.pid,
    startTimeTicks: childStartTimeTicks,
    bootId: host.bootId,
    hostPid: host.pid,
    hostStartTimeTicks: host.startTimeTicks,
    logDir,
    recordedAt: Date.now(),
  };
}
