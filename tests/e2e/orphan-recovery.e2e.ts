import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { assert, expect } from "vitest";

import { ProcessManager } from "../../src/manager";
import { isProcessGroupAlive } from "../../src/utils";
import {
  readBootId,
  readProcessStartTime,
} from "../../src/utils/proc-identity";
import { test } from "./fixtures";
import { waitForEnd } from "./utils";

async function deadHostIdentity(): Promise<{ pid: number; startTime: string }> {
  const child = spawn("sleep", ["0.05"]);
  assert(child.pid, "sleep should have a pid");
  const startTime = readProcessStartTime(child.pid);
  assert(startTime, "sleep starttime should be readable");
  await new Promise((resolve) => child.once("exit", resolve));
  return { pid: child.pid, startTime };
}

async function repointRecordAtDeadHost(
  stateDir: string,
  id: string,
  extraTamper?: (record: Record<string, unknown>) => void,
): Promise<string> {
  const deadHost = await deadHostIdentity();
  const original = join(stateDir, `${process.pid}-${id}.json`);
  const record = JSON.parse(readFileSync(original, "utf-8")) as Record<
    string,
    unknown
  >;
  record.hostPid = deadHost.pid;
  record.hostStartTimeTicks = deadHost.startTime;
  extraTamper?.(record);

  const rewritten = join(stateDir, `${deadHost.pid}-${id}.json`);
  writeFileSync(rewritten, JSON.stringify(record));
  rmSync(original, { force: true });
  return rewritten;
}

const cwdTest = test.skipIf(readBootId() === null);

async function waitForGroupDeath(
  pgid: number,
  timeoutMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(pgid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isProcessGroupAlive(pgid);
}

cwdTest(
  "reap kills a verified orphan group left by a dead host",
  { timeout: 15_000 },
  async ({ cwd, addScript }) => {
    addScript("wait-for-file.sh");
    const stateDir = join(cwd, "orphan-records");
    const manager = new ProcessManager({
      orphanRecords: { dir: stateDir },
    });

    const info = manager.start("leak", "./wait-for-file.sh never", cwd);
    const ended = waitForEnd(manager, info.id);
    const originalRecord = join(stateDir, `${process.pid}-${info.id}.json`);
    assert(existsSync(originalRecord), "record should persist on start");

    const recordFile = await repointRecordAtDeadHost(stateDir, info.id);

    const reaper = new ProcessManager({
      orphanRecords: { dir: stateDir },
    });
    const report = reaper.reapOrphanedProcesses();

    expect(report.killed).toEqual([
      {
        id: info.id,
        name: "leak",
        command: "./wait-for-file.sh never",
        pid: info.pid,
      },
    ]);
    expect(existsSync(recordFile)).toBe(false);

    const endedInfo = await ended;
    expect(endedInfo.status).toBe("killed");
    const groupDead = await waitForGroupDeath(info.pid);
    expect(groupDead).toBe(true);

    manager.cleanup();
    reaper.cleanup();
  },
);

cwdTest(
  "reap keeps a group whose owning host is still alive",
  { timeout: 15_000 },
  async ({ cwd, addScript }) => {
    addScript("wait-for-file.sh");
    const stateDir = join(cwd, "orphan-records");
    const manager = new ProcessManager({
      orphanRecords: { dir: stateDir },
    });

    const info = manager.start("live", "./wait-for-file.sh never", cwd);
    const recordFile = join(stateDir, `${process.pid}-${info.id}.json`);
    assert(existsSync(recordFile), "record should persist on start");

    const other = new ProcessManager({ orphanRecords: { dir: stateDir } });
    const report = other.reapOrphanedProcesses();

    expect(report).toEqual({ killed: [], discarded: [], kept: 1 });
    expect(existsSync(recordFile)).toBe(true);
    expect(isProcessGroupAlive(info.pid)).toBe(true);
    expect(manager.get(info.id)?.status).toBe("running");

    other.cleanup();
    manager.cleanup();
    await waitForEnd(manager, info.id);
    const groupDead = await waitForGroupDeath(info.pid);
    expect(groupDead).toBe(true);
  },
);

cwdTest(
  "reap never signals a group whose recorded identity no longer matches",
  { timeout: 15_000 },
  async ({ cwd, addScript }) => {
    addScript("wait-for-file.sh");
    const stateDir = join(cwd, "orphan-records");
    const manager = new ProcessManager({
      orphanRecords: { dir: stateDir },
    });

    const info = manager.start("reused", "./wait-for-file.sh never", cwd);
    const originalRecord = join(stateDir, `${process.pid}-${info.id}.json`);
    assert(existsSync(originalRecord), "record should persist on start");

    const recordFile = await repointRecordAtDeadHost(
      stateDir,
      info.id,
      (record) => {
        record.startTimeTicks = "999999999";
      },
    );

    const reaper = new ProcessManager({
      orphanRecords: { dir: stateDir },
    });
    const report = reaper.reapOrphanedProcesses();

    expect(report.killed).toEqual([]);
    expect(report.discarded).toEqual([
      { id: info.id, name: "reused", reason: "pid_reused" },
    ]);
    expect(existsSync(recordFile)).toBe(false);
    expect(isProcessGroupAlive(info.pid)).toBe(true);

    manager.cleanup();
    reaper.cleanup();
  },
);
