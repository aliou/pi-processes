import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { vol } from "memfs";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ProcessManager } from "./index";
import {
  ORPHAN_RECORD_VERSION,
  type OrphanProcessRecord,
  type OrphanReapDeps,
  OrphanRecordStore,
  reapOrphanedRecords,
  removeOrphanLogDir,
  STRAY_TEMP_FILE_MAX_AGE_MS,
} from "./orphan-recovery";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const STATE_DIR = "/state/orphans";

function makeRecord(
  overrides?: Partial<OrphanProcessRecord>,
): OrphanProcessRecord {
  return {
    version: ORPHAN_RECORD_VERSION,
    id: "proc_aa",
    name: "srv",
    command: "sleep 900",
    cwd: "/work",
    pid: 5000,
    startTimeTicks: "111",
    bootId: "boot-1",
    hostPid: 4000,
    hostStartTimeTicks: "222",
    logDir: "/tmp/pi-processes-abc",
    recordedAt: 1_700_000_000_000,
    ...overrides,
  };
}

interface DepOverrides {
  bootId?: string | null;
  hostPidAlive?: boolean;
  hostStartTime?: string | null;
  childStartTime?: string | null;
  groupAlive?: boolean;
  killGroup?: (pgid: number) => void;
}

function makeDeps(overrides?: DepOverrides): {
  deps: OrphanReapDeps;
  killedGroups: number[];
  removedLogDirs: string[];
} {
  const killedGroups: number[] = [];
  const removedLogDirs: string[] = [];
  const deps: OrphanReapDeps = {
    identity: {
      bootId: () =>
        overrides?.bootId === undefined ? "boot-1" : overrides.bootId,
      processStartTime: (pid) => {
        if (pid === 4000) {
          return overrides?.hostStartTime === undefined
            ? "222"
            : overrides.hostStartTime;
        }
        return overrides?.childStartTime === undefined
          ? "111"
          : overrides.childStartTime;
      },
    },
    isPidAlive: (pid) =>
      pid === 4000 ? (overrides?.hostPidAlive ?? true) : pid === 5000,
    isGroupAlive: () => overrides?.groupAlive ?? true,
    killGroup: overrides?.killGroup ?? ((pgid) => killedGroups.push(pgid)),
    removeLogDir: (dir) => removedLogDirs.push(dir),
  };
  return { deps, killedGroups, removedLogDirs };
}

function writeRecords(...records: OrphanProcessRecord[]): OrphanRecordStore {
  const store = new OrphanRecordStore(STATE_DIR);
  for (const record of records) store.write(record);
  return store;
}

function recordFile(record: { hostPid: number; id: string }): string {
  return `${STATE_DIR}/${record.hostPid}-${record.id}.json`;
}

beforeEach(() => {
  vol.reset();
});

// ---------------------------------------------------------------------------
// OrphanRecordStore
// ---------------------------------------------------------------------------

describe("OrphanRecordStore", () => {
  it("round-trips written records", () => {
    const store = writeRecords(makeRecord());

    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(makeRecord());
  });

  it("writes atomically and leaves no temp file", () => {
    writeRecords(makeRecord());

    const files = vol.readdirSync(STATE_DIR) as string[];
    expect(files).toEqual(["4000-proc_aa.json"]);
  });

  it("removes records by host pid and id", () => {
    const store = writeRecords(makeRecord());
    const file = recordFile({ hostPid: 4000, id: "proc_aa" });
    assert(existsSync(file), "record file should exist");

    store.remove({ hostPid: 4000, id: "proc_aa" });

    expect(existsSync(file)).toBe(false);
    expect(store.list()).toHaveLength(0);
  });

  it("removes only the files this store instance wrote", () => {
    const storeA = writeRecords(makeRecord());
    const storeB = new OrphanRecordStore(STATE_DIR);
    storeB.write(makeRecord({ id: "proc_bb", hostPid: 4100 }));

    storeA.removeWritten();

    expect(existsSync(recordFile({ hostPid: 4000, id: "proc_aa" }))).toBe(
      false,
    );
    expect(existsSync(recordFile({ hostPid: 4100, id: "proc_bb" }))).toBe(true);
  });

  it("discards corrupt record files", () => {
    const store = new OrphanRecordStore(STATE_DIR);
    vol.mkdirSync(STATE_DIR, { recursive: true });
    vol.writeFileSync(`${STATE_DIR}/4000-proc_broken.json`, "{not json");

    expect(store.list()).toHaveLength(0);
    expect(existsSync(`${STATE_DIR}/4000-proc_broken.json`)).toBe(false);
  });

  it("discards same-version records with an invalid shape", () => {
    const store = new OrphanRecordStore(STATE_DIR);
    vol.mkdirSync(STATE_DIR, { recursive: true });
    vol.writeFileSync(
      `${STATE_DIR}/4000-proc_nopid.json`,
      JSON.stringify({ ...makeRecord(), id: "proc_nopid", pid: "x" }),
    );

    expect(store.list()).toHaveLength(0);
    expect(existsSync(`${STATE_DIR}/4000-proc_nopid.json`)).toBe(false);
  });

  it("keeps records with a newer format version for the newer session", () => {
    const store = new OrphanRecordStore(STATE_DIR);
    vol.mkdirSync(STATE_DIR, { recursive: true });
    vol.writeFileSync(
      `${STATE_DIR}/4000-proc_v2.json`,
      JSON.stringify({ ...makeRecord(), id: "proc_v2", version: 99 }),
    );

    expect(store.list()).toHaveLength(0);
    expect(existsSync(`${STATE_DIR}/4000-proc_v2.json`)).toBe(true);
  });

  it("degrades to no record when the directory is unwritable", () => {
    vol.mkdirSync("/state", { recursive: true });
    vol.writeFileSync("/state/blocker", "not a directory");
    const store = new OrphanRecordStore("/state/blocker");

    expect(() => store.write(makeRecord())).not.toThrow();
    expect(() => store.remove({ hostPid: 4000, id: "proc_aa" })).not.toThrow();
    expect(() => store.removeWritten()).not.toThrow();
    expect(store.list()).toEqual([]);
  });

  it("prunes stale temp files but keeps fresh ones", () => {
    const store = new OrphanRecordStore(STATE_DIR);
    vol.mkdirSync(STATE_DIR, { recursive: true });
    const stale = `${STATE_DIR}/4000-proc_old.json.deadbeef.tmp`;
    const fresh = `${STATE_DIR}/4000-proc_new.json.cafebabe.tmp`;
    vol.writeFileSync(stale, "");
    vol.writeFileSync(fresh, "");
    const old = new Date(Date.now() - (STRAY_TEMP_FILE_MAX_AGE_MS + 60_000));
    vol.utimesSync(stale, old, old);

    expect(store.list()).toEqual([]);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("ignores non-json entries and a missing directory", () => {
    const store = new OrphanRecordStore(STATE_DIR);
    expect(store.list()).toEqual([]);

    vol.mkdirSync(STATE_DIR, { recursive: true });
    vol.writeFileSync(`${STATE_DIR}/notes.txt`, "hello");
    expect(store.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reapOrphanedRecords
// ---------------------------------------------------------------------------

describe("reapOrphanedRecords", () => {
  it("keeps a group whose owning pi host is still alive", () => {
    const store = writeRecords(makeRecord());
    const { deps, killedGroups, removedLogDirs } = makeDeps();

    const report = reapOrphanedRecords(store, deps);

    expect(report).toEqual({ killed: [], discarded: [], kept: 1 });
    expect(killedGroups).toEqual([]);
    expect(removedLogDirs).toEqual([]);
    expect(existsSync(recordFile({ hostPid: 4000, id: "proc_aa" }))).toBe(true);
  });

  it("keeps a record when the host pid is alive but unverifiable", () => {
    const store = writeRecords(makeRecord());
    const { deps } = makeDeps({ hostStartTime: null });

    const report = reapOrphanedRecords(store, deps);

    // Conservative: cannot prove the host is dead, so nothing is touched.
    expect(report).toEqual({ killed: [], discarded: [], kept: 1 });
  });

  it("kills the group when the host is dead and identity matches", () => {
    const store = writeRecords(makeRecord());
    const { deps, killedGroups, removedLogDirs } = makeDeps({
      hostPidAlive: false,
    });

    const report = reapOrphanedRecords(store, deps);

    expect(report.killed).toEqual([
      { id: "proc_aa", name: "srv", command: "sleep 900", pid: 5000 },
    ]);
    expect(report.discarded).toEqual([]);
    expect(report.kept).toBe(0);
    expect(killedGroups).toEqual([5000]);
    expect(removedLogDirs).toEqual(["/tmp/pi-processes-abc"]);
    expect(existsSync(recordFile({ hostPid: 4000, id: "proc_aa" }))).toBe(
      false,
    );
  });

  it("treats a reused host pid (different starttime) as a dead host", () => {
    const store = writeRecords(makeRecord());
    const { deps, killedGroups } = makeDeps({
      hostStartTime: "999",
      hostPidAlive: true,
    });

    const report = reapOrphanedRecords(store, deps);

    expect(report.killed).toHaveLength(1);
    expect(killedGroups).toEqual([5000]);
  });

  it("never signals a reused child pid", () => {
    const store = writeRecords(makeRecord());
    const { deps, killedGroups } = makeDeps({
      hostPidAlive: false,
      childStartTime: "999",
    });

    const report = reapOrphanedRecords(store, deps);

    expect(report.killed).toEqual([]);
    expect(report.discarded).toEqual([
      { id: "proc_aa", name: "srv", reason: "pid_reused" },
    ]);
    expect(killedGroups).toEqual([]);
    expect(existsSync(recordFile({ hostPid: 4000, id: "proc_aa" }))).toBe(
      false,
    );
  });

  it("discards without killing when the group leader is gone", () => {
    const store = writeRecords(makeRecord());
    const { deps, killedGroups } = makeDeps({
      hostPidAlive: false,
      childStartTime: null,
    });

    const report = reapOrphanedRecords(store, deps);

    expect(report.killed).toEqual([]);
    expect(report.discarded).toEqual([
      { id: "proc_aa", name: "srv", reason: "leader_gone" },
    ]);
    expect(killedGroups).toEqual([]);
  });

  it("discards a matched-identity group that already died", () => {
    const store = writeRecords(makeRecord());
    const { deps, killedGroups } = makeDeps({
      hostPidAlive: false,
      groupAlive: false,
    });

    const report = reapOrphanedRecords(store, deps);

    expect(report.killed).toEqual([]);
    expect(report.discarded).toEqual([
      { id: "proc_aa", name: "srv", reason: "already_dead" },
    ]);
    expect(killedGroups).toEqual([]);
    expect(existsSync(recordFile({ hostPid: 4000, id: "proc_aa" }))).toBe(
      false,
    );
  });

  it("discards records from a previous boot without signaling", () => {
    const store = writeRecords(makeRecord({ bootId: "boot-old" }));
    const { deps, killedGroups, removedLogDirs } = makeDeps();

    const report = reapOrphanedRecords(store, deps);

    expect(report.killed).toEqual([]);
    expect(report.discarded).toEqual([
      { id: "proc_aa", name: "srv", reason: "rebooted" },
    ]);
    expect(killedGroups).toEqual([]);
    expect(removedLogDirs).toEqual(["/tmp/pi-processes-abc"]);
  });

  it("is a no-op when no boot id is available", () => {
    const store = writeRecords(makeRecord());
    const { deps, killedGroups } = makeDeps({ bootId: null });

    const report = reapOrphanedRecords(store, deps);

    expect(report).toEqual({ killed: [], discarded: [], kept: 0 });
    expect(killedGroups).toEqual([]);
    expect(existsSync(recordFile({ hostPid: 4000, id: "proc_aa" }))).toBe(true);
  });

  it("processes every record independently", () => {
    const store = writeRecords(
      makeRecord({ id: "proc_aa", hostPid: 4000, pid: 5000 }),
      makeRecord({
        id: "proc_bb",
        hostPid: 4100,
        pid: 5100,
        startTimeTicks: "111",
      }),
      makeRecord({
        id: "proc_cc",
        hostPid: 4200,
        pid: 5200,
        bootId: "boot-old",
      }),
    );
    const { deps } = makeDeps();

    // Host 4100 is not alive: its record is reaped. Hosts 4000 (alive) and
    // 4200 (rebooted) exercise the other two branches.
    const report = reapOrphanedRecords(store, deps);

    expect(report.kept).toBe(1);
    expect(report.killed.map((k) => k.id)).toEqual(["proc_bb"]);
    expect(report.discarded).toEqual([
      { id: "proc_cc", name: "srv", reason: "rebooted" },
    ]);
  });

  it("reports ESRCH from the group kill as already dead and keeps reaping", () => {
    const store = writeRecords(
      makeRecord({ id: "proc_aa", pid: 5000 }),
      makeRecord({ id: "proc_bb", hostPid: 4100, pid: 5100 }),
    );
    const { deps, killedGroups } = makeDeps({
      hostPidAlive: false,
      killGroup: (pgid) => {
        if (pgid === 5000) {
          throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
        }
        killedGroups.push(pgid);
      },
    });

    const report = reapOrphanedRecords(store, deps);

    expect(report.killed.map((k) => k.id)).toEqual(["proc_bb"]);
    expect(report.discarded).toEqual([
      { id: "proc_aa", name: "srv", reason: "already_dead" },
    ]);
    expect(killedGroups).toEqual([5100]);
  });

  it("continues the loop when the group kill fails", () => {
    const store = writeRecords(
      makeRecord({ id: "proc_aa", pid: 5000 }),
      makeRecord({ id: "proc_bb", hostPid: 4100, pid: 5100 }),
    );
    const { deps, killedGroups } = makeDeps({
      hostPidAlive: false,
      killGroup: (pgid) => {
        if (pgid === 5000) {
          throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
        }
        killedGroups.push(pgid);
      },
    });

    const report = reapOrphanedRecords(store, deps);

    expect(report.killed.map((k) => k.id)).toEqual(["proc_bb"]);
    expect(report.discarded).toEqual([
      { id: "proc_aa", name: "srv", reason: "kill_failed" },
    ]);
    expect(killedGroups).toEqual([5100]);
  });
});

describe("removeOrphanLogDir", () => {
  it("removes mkdtemp-created log directories under the temp dir", () => {
    const dir = join(tmpdir(), "pi-processes-abc");
    vol.mkdirSync(dir, { recursive: true });

    removeOrphanLogDir(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it("leaves matching basenames outside the temp dir in place", () => {
    vol.mkdirSync("/var/logs/pi-processes-lookalike", { recursive: true });

    removeOrphanLogDir("/var/logs/pi-processes-lookalike");

    expect(existsSync("/var/logs/pi-processes-lookalike")).toBe(true);
  });

  it("leaves explicitly configured log directories in place", () => {
    vol.mkdirSync(join(tmpdir(), "custom"), { recursive: true });

    removeOrphanLogDir(join(tmpdir(), "custom"));

    expect(existsSync(join(tmpdir(), "custom"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ProcessManager integration
// ---------------------------------------------------------------------------

const fakeProcesses = new Map<number, FakeChildProcess>();
let nextPid = 20_000;

class FakeChildProcess extends EventEmitter {
  pid: number | undefined = ++nextPid;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  unref(): void {}

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    this.finish(null, signal);
    return true;
  }

  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    if (this.pid !== undefined) fakeProcesses.delete(this.pid);
    this.stdout.end();
    this.stderr.end();
    queueMicrotask(() => this.emit("close", code, signal));
  }
}

vi.mock("../utils/command-executor", () => ({
  resolveShellExecutable: vi.fn(() => "/bin/bash"),
  spawnCommand: vi.fn((command: string) => {
    const child = new FakeChildProcess();
    if (child.pid !== undefined) fakeProcesses.set(child.pid, child);
    queueMicrotask(() => {
      if (command.includes("sleep 60")) return;
      child.finish(0);
    });
    return child;
  }),
}));

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return {
    ...actual,
    isProcessGroupAlive: vi.fn((pid: number) => fakeProcesses.has(pid)),
    killProcessGroup: vi.fn((pid: number, signal: NodeJS.Signals) => {
      const child = fakeProcesses.get(pid);
      if (child) child.kill(signal);
    }),
  };
});

let hostAlive = true;
let procfsBootIdAvailable = true;

vi.mock("../utils/proc-identity", () => ({
  isPidAlive: vi.fn((pid: number) =>
    pid === process.pid ? hostAlive : fakeProcesses.has(pid),
  ),
  procfsIdentity: {
    bootId: () => (procfsBootIdAvailable ? "boot-test" : null),
    processStartTime: (pid: number) => String(pid),
  },
}));

const fakeIdentity = {
  bootId: () => "boot-test",
  processStartTime: (pid: number) => String(pid),
};

function managerOptions(dir = STATE_DIR) {
  return {
    orphanRecords: { dir, identity: fakeIdentity },
  };
}

function readRecordFile(
  hostPid: number,
  id: string,
): Record<string, unknown> | null {
  const file = `${STATE_DIR}/${hostPid}-${id}.json`;
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
}

beforeEach(() => {
  fakeProcesses.clear();
  hostAlive = true;
  procfsBootIdAvailable = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessManager orphan records", () => {
  it("persists a record when a process starts", () => {
    using manager = new ProcessManager(managerOptions());
    const info = manager.start("srv", "sleep 60", "/work");

    const record = readRecordFile(process.pid, info.id);
    assert(record, "record file should exist");
    expect(record).toEqual(
      expect.objectContaining({
        version: ORPHAN_RECORD_VERSION,
        id: info.id,
        name: "srv",
        command: "sleep 60",
        cwd: "/work",
        pid: info.pid,
        startTimeTicks: String(info.pid),
        bootId: "boot-test",
        hostPid: process.pid,
        hostStartTimeTicks: String(process.pid),
      }),
    );
    expect(typeof record.logDir).toBe("string");
    expect(typeof record.recordedAt).toBe("number");
  });

  it("writes no record when procfs identity is unavailable", () => {
    procfsBootIdAvailable = false;
    using manager = new ProcessManager({ orphanRecords: { dir: STATE_DIR } });
    const info = manager.start("srv", "sleep 60", "/work");

    expect(readRecordFile(process.pid, info.id)).toBeNull();
    expect(manager.reapOrphanedProcesses()).toEqual({
      killed: [],
      discarded: [],
      kept: 0,
    });
  });

  it("writes no record when orphan persistence is not enabled", () => {
    using manager = new ProcessManager();
    const info = manager.start("srv", "sleep 60", "/work");

    expect(readRecordFile(process.pid, info.id)).toBeNull();
    expect(manager.reapOrphanedProcesses()).toEqual({
      killed: [],
      discarded: [],
      kept: 0,
    });
  });

  // Regression: a record-dir I/O failure used to throw out of start()
  // after the child was spawned, leaving it alive with no stdio handlers.
  it("keeps starting and stopping processes when the record directory is unwritable", async () => {
    vol.mkdirSync("/state", { recursive: true });
    vol.writeFileSync("/state/blocker", "not a directory");
    using manager = new ProcessManager({
      orphanRecords: { dir: "/state/blocker", identity: fakeIdentity },
    });

    const info = manager.start("srv", "sleep 60", "/work");

    expect(info.status).toBe("running");
    expect(readRecordFile(process.pid, info.id)).toBeNull();
    expect(manager.reapOrphanedProcesses()).toEqual({
      killed: [],
      discarded: [],
      kept: 0,
    });

    const child = fakeProcesses.get(info.pid);
    assert(child, "fake child should exist");
    const ended = new Promise<void>((resolve) => {
      const unsub = manager.onEvent((event) => {
        if (event.type === "process_ended" && event.info.id === info.id) {
          unsub();
          resolve();
        }
      });
    });
    child.finish(0);
    await ended;

    expect(() => manager.cleanup()).not.toThrow();
  });

  it("removes the record when the process ends", async () => {
    using manager = new ProcessManager(managerOptions());
    const info = manager.start("task", "true", "/work");
    const child = fakeProcesses.get(info.pid);
    assert(child, "fake child should exist");

    const ended = new Promise<void>((resolve) => {
      const unsub = manager.onEvent((e) => {
        if (e.type === "process_ended" && e.info.id === info.id) {
          unsub();
          resolve();
        }
      });
    });
    child.finish(0);
    await ended;

    expect(readRecordFile(process.pid, info.id)).toBeNull();
  });

  it("keeps the record while the process is live and removes it on cleanup", () => {
    using manager = new ProcessManager(managerOptions());
    const info = manager.start("srv", "sleep 60", "/work");

    expect(readRecordFile(process.pid, info.id)).not.toBeNull();

    manager.cleanup();

    expect(readRecordFile(process.pid, info.id)).toBeNull();
  });

  it("reaps the group of a dead host", () => {
    using manager = new ProcessManager(managerOptions());
    const info = manager.start("srv", "sleep 60", "/work");
    const child = fakeProcesses.get(info.pid);
    assert(child, "fake child should exist");
    hostAlive = false;

    const report = manager.reapOrphanedProcesses();

    expect(report.killed).toEqual([
      {
        id: info.id,
        name: "srv",
        command: "sleep 60",
        pid: info.pid,
      },
    ]);
    expect(readRecordFile(process.pid, info.id)).toBeNull();
    expect(child.killed).toBe(true);
  });

  it("keeps the group of a live host", () => {
    using manager = new ProcessManager(managerOptions());
    const info = manager.start("srv", "sleep 60", "/work");

    const report = manager.reapOrphanedProcesses();

    expect(report.kept).toBe(1);
    expect(report.killed).toEqual([]);
    expect(readRecordFile(process.pid, info.id)).not.toBeNull();
    const child = fakeProcesses.get(info.pid);
    expect(child?.killed).toBe(false);
  });

  it("never signals a record whose child pid was reused", () => {
    using manager = new ProcessManager(managerOptions());
    const info = manager.start("srv", "sleep 60", "/work");

    // Tamper the persisted starttime to simulate a PID reuse.
    const file = `${STATE_DIR}/${process.pid}-${info.id}.json`;
    const record = JSON.parse(readFileSync(file, "utf-8")) as Record<
      string,
      unknown
    >;
    record.startTimeTicks = "999999";
    vol.writeFileSync(file, JSON.stringify(record));
    hostAlive = false;

    const report = manager.reapOrphanedProcesses();

    expect(report.killed).toEqual([]);
    expect(report.discarded).toEqual([
      { id: info.id, name: "srv", reason: "pid_reused" },
    ]);
    const child = fakeProcesses.get(info.pid);
    expect(child?.killed).toBe(false);
  });
});
