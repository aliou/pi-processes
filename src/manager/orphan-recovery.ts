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

export const STRAY_TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;

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

export interface HostIdentity {
  bootId: string;
  pid: number;
  startTimeTicks: string;
}

export interface ReapedOrphanSummary {
  id: string;
  name: string;
  command: string;
  pid: number;
}

export type DiscardedOrphanReason =
  | "rebooted"
  | "pid_reused"
  | "leader_gone"
  | "already_dead"
  | "kill_failed";

export interface OrphanReapReport {
  killed: ReapedOrphanSummary[];
  discarded: Array<{ id: string; name: string; reason: DiscardedOrphanReason }>;
  kept: number;
}

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

export class OrphanRecordStore {
  private readonly dir: string;
  private readonly written = new Set<string>();

  constructor(dir: string) {
    this.dir = dir;
  }

  write(record: OrphanProcessRecord): void {
    const file = join(this.dir, recordFileName(record));
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
        void _cleanupError;
      }
    }
  }

  remove(record: { hostPid: number; id: string }): void {
    const file = join(this.dir, recordFileName(record));
    this.written.delete(file);
    try {
      rmSync(file, { force: true });
    } catch (_error) {
      void _error;
    }
  }

  removeWritten(): void {
    const files = [...this.written];
    this.written.clear();
    for (const file of files) {
      try {
        rmSync(file, { force: true });
      } catch (_error) {
        void _error;
      }
    }
  }

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
      void _error;
    }
  }

  private pruneTempFile(file: string): void {
    try {
      const mtimeMs = statSync(file).mtimeMs;
      if (Date.now() - mtimeMs < STRAY_TEMP_FILE_MAX_AGE_MS) return;
    } catch (_error) {
      return;
    }
    this.removeFile(file);
  }
}

function isHostAlive(
  record: OrphanProcessRecord,
  deps: OrphanReapDeps,
): boolean {
  if (!deps.isPidAlive(record.hostPid)) return false;
  const hostStart = deps.identity.processStartTime(record.hostPid);
  if (hostStart === null) return true;
  return hostStart === record.hostStartTimeTicks;
}

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

export function removeOrphanLogDir(dir: string): void {
  if (dirname(dir) !== tmpdir()) return;
  if (!basename(dir).startsWith("pi-processes-")) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (_error) {
    void _error;
  }
}

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
