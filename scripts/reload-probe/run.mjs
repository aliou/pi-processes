import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmodSync, closeSync, copyFileSync, existsSync, fstatSync, mkdirSync,
  mkdtempSync, readFileSync, rmSync, watch, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadManager } from "./bootstrap.mjs";

const root = mkdtempSync(join(tmpdir(), "manager-reload-"));
const fixtures = fileURLToPath(new URL("../../tests/e2e/scripts/", import.meta.url));
const keep = process.argv.includes("--keep");
const selection = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const hostPid = process.pid;
const sessions = [];
const exec = promisify(execFile);
let name = "setup";

function log(message, data) {
  console.log(`[${name}] ${message}`);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

function quote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }

function alive(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function waitForDead(pid) {
  const deadline = Date.now() + 5000;
  while (alive(pid)) {
    assert(Date.now() < deadline, `Group ${pid} did not stop`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  log(`OS confirms PGID ${pid} is gone`);
}

function waitForText(path, predicate, description) {
  log(`wait on ${path}: ${description}`);
  return new Promise((resolve, reject) => {
    let done = false;
    const watcher = watch(dirname(path), check);
    const interval = setInterval(check, 25);
    const timeout = setTimeout(() => finish(new Error(`Timeout: ${description}`)), 10_000);
    function finish(error, result) {
      if (done) return;
      done = true;
      watcher.close(); clearInterval(interval); clearTimeout(timeout);
      if (error) reject(error); else resolve(result);
    }
    function check() {
      if (!existsSync(path)) return;
      const text = readFileSync(path, "utf8");
      if (predicate(text)) finish(null, text);
    }
    check();
  });
}

const contains = (path, text) => waitForText(path, (bytes) => bytes.includes(text), JSON.stringify(text));

async function tree(record) {
  const { stdout } = await exec("ps", ["-ax", "-o", "pid=,ppid=,pgid=,stat=,command="]);
  const rows = stdout.split("\n").filter((line) => Number(line.trim().split(/\s+/)[2]) === record.pid);
  log(`host PID ${process.pid}; workload tree PID PPID PGID STAT COMMAND`);
  console.log(rows.join("\n") || "(no group members)");
  assert(!rows.some((line) => /supervisor|bootstrap|reload-probe/.test(line)), "No helper process may own the workload");
  return rows;
}

async function start(mode, fixture, args, ready) {
  const cwd = join(root, name);
  mkdirSync(cwd);
  copyFileSync(join(fixtures, fixture), join(cwd, fixture));
  chmodSync(join(cwd, fixture), 0o755);
  const executable = fixture.endsWith(".mjs") ? quote(process.execPath) : "bash";
  const command = `exec ${executable} ./${fixture} ${(args ?? []).map(quote).join(" ")}`.trim();
  const { ProbeManager } = await loadManager();
  const session = { manager: new ProbeManager(), record: null, cwd, generation: 1 };
  sessions.push(session);
  session.record = session.manager.start(command, cwd, mode);
  log(`generation 1 in host PID ${process.pid}; mode=${mode}; command=${JSON.stringify(command)}`, session.record);
  await contains(session.record.stdoutFile, ready);
  const rows = await tree(session.record);
  assert(rows.some((line) => Number(line.trim().split(/\s+/)[0]) === session.record.pid && line.includes(`./${fixture}`)), "Fixture itself must be the group leader; no wrapper");
  return session;
}

function inspect(session) {
  const info = session.manager.inspect();
  log(`generation ${session.generation} inspection:`, info);
  return info;
}

function discard(session) {
  const weak = new WeakRef(session.manager);
  const snapshot = session.manager.detach();
  writeFileSync(join(session.cwd, "state.json"), JSON.stringify(snapshot, null, 2));
  session.manager = null;
  // Cleanup evidence is plain metadata, never a child/stream/manager object.
  session.record = JSON.parse(readFileSync(join(session.cwd, "state.json"), "utf8"));
  log(`generation ${session.generation} removed callbacks, closed JS streams, and discarded manager`, session.record);
  return weak;
}

async function detach(session) {
  const weak = discard(session);
  // Allow Node's stream-close callbacks and the old JS stack to unwind.
  await nextTurn();
  if (global.gc) {
    global.gc();
    await nextTurn();
    global.gc();
    assert.equal(weak.deref(), undefined, "Old manager must be collectable, not kept alive by callbacks");
    log("ASSERT: old manager was garbage-collected");
  } else {
    log("GC check NOT RUN; use node --expose-gc to prove old manager collection");
  }
  assert.equal(session.manager, null);
  assert.equal(process.pid, hostPid);
}

async function restore(session) {
  assert.equal(session.manager, null);
  const snapshot = JSON.parse(readFileSync(join(session.cwd, "state.json"), "utf8"));
  const { ProbeManager } = await loadManager();
  session.manager = new ProbeManager(snapshot);
  session.generation++;
  assert.equal(process.pid, hostPid);
  log(`fresh module and manager generation ${session.generation}, SAME host PID ${process.pid}; input is only state.json`);
  const info = inspect(session);
  assert.equal(info.id, session.record.id);
  assert.equal(info.pid, session.record.pid);
  assert.equal(info.attachedChildObject, false);
  assert.equal(info.outcomeKnown, false);
  const rows = await tree(session.record);
  if (info.alive) assert(rows.some((line) => Number(line.trim().split(/\s+/)[0]) === info.pid));
  return info;
}

function marker(session, filename) {
  log(`write marker ${join(session.cwd, filename)} while manager=${session.manager ? "attached" : "ABSENT"}`);
  writeFileSync(join(session.cwd, filename), "");
}

async function stop(session) {
  log(`fresh manager sends SIGTERM to PGID ${session.record.pid}`);
  session.manager.stop();
  await waitForDead(session.record.pid);
  const info = inspect(session);
  assert.equal(info.exitCode, null);
  assert.equal(info.outcomeKnown, false);
}

async function baseline() {
  const session = await start("pipes", "wait-for-file.sh", ["release", "after-detach"], "waiting for release");
  const before = readFileSync(session.record.stdoutFile, "utf8");
  await detach(session);
  await restore(session);
  const result = session.manager.write("hello\n");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_restorable_stdin");
  marker(session, "release");
  await waitForDead(session.record.pid);
  assert.equal(readFileSync(session.record.stdoutFile, "utf8"), before);
  log("LIMITATION CONFIRMED: closed anonymous pipes cannot be restored by PID/path; new output was not logged", result);
}

async function output(fixture, prefix, stderrPrefix) {
  const session = await start("files", fixture, [], `${prefix}0`);
  await detach(session);
  const before = readFileSync(session.record.stdoutFile, "utf8");
  const stderrBefore = readFileSync(session.record.stderrFile, "utf8");
  const hasNewLine = (text, previous, wanted) => text.startsWith(previous) && text.slice(previous.length).split("\n").slice(0, -1).some((line) => line.startsWith(wanted));
  await waitForText(session.record.stdoutFile, (text) => hasNewLine(text, before, prefix), "new stdout line with no manager");
  if (stderrPrefix) await waitForText(session.record.stderrFile, (text) => hasNewLine(text, stderrBefore, stderrPrefix), "new stderr line with no manager");
  log("gap stdout:", readFileSync(session.record.stdoutFile, "utf8").slice(before.length));
  if (stderrPrefix) log("gap stderr:", readFileSync(session.record.stderrFile, "utf8").slice(stderrBefore.length));
  assert.equal((await restore(session)).alive, true);
  await stop(session);
}

async function watcher() {
  const session = await start("files", "stateful-test-watcher.mjs", [], "FAIL missing table: customers");
  for (const [filename, expected] of [["01-migrated", "FAIL missing seed data: orders"], ["02-seeded", "FAIL missing shipping calculator"], ["03-shipping", "PASS all watched tests"]]) {
    await detach(session);
    marker(session, filename);
    await contains(session.record.stdoutFile, expected);
    await restore(session);
  }
  const info = inspect(session);
  for (const line of ["PASS 01-migrated", "PASS 02-seeded", "PASS 03-shipping"]) assert(info.stdout.includes(line));
  await stop(session);
}

async function completed(failure) {
  const fixture = failure ? "crash-on-file.sh" : "wait-for-file.sh";
  const trigger = failure ? "crash-now" : "release-output";
  const session = await start("files", fixture, [], failure ? "worker waiting for crash-now" : "waiting for release-output");
  await detach(session);
  marker(session, trigger);
  await waitForDead(session.record.pid);
  const info = await restore(session);
  assert.equal(info.alive, false);
  assert.equal(info.exitCode, null);
  assert.equal(info.signal, null);
  if (failure) assert(info.stderr.includes("fatal: marker crash-now detected"));
  else assert(info.stdout.includes("dynamic ready"));
  log(`LIMITATION CONFIRMED: fixture's expected exit ${failure ? 42 : 0} is NOT recoverable; old close callback was removed`);
}

async function crashed() {
  const session = await start("files", "continuous-output.sh", [], "ping 0");
  await detach(session);
  log(`SIGKILL workload group ${session.record.pid} BEFORE restoration`);
  process.kill(-session.record.pid, "SIGKILL");
  await waitForDead(session.record.pid);
  const info = await restore(session);
  assert.equal(info.alive, false);
  assert.equal(info.signal, null);
  log("LIMITATION CONFIRMED: death detected, original signal not recovered from saved metadata");
}

async function fifoPath() {
  const session = await start("fifo-path", "stdin-echo.sh", [], "stdin repl ready");
  assert.equal(session.manager.write("before-detach\n").ok, true);
  await contains(session.record.stdoutFile, "echo:before-detach");
  await detach(session);
  assert.equal(session.record.descriptor, undefined);
  await contains(session.record.stdoutFile, "stdin closed");
  await waitForDead(session.record.pid);
  await restore(session);
  const result = session.manager.write("after-restore\n");
  assert.equal(result.ok, false);
  assert(!readFileSync(session.record.stdoutFile, "utf8").includes("echo:after-restore"));
  log("LIMITATION CONFIRMED: closing every parent FIFO handle produced EOF; path-only restore cannot revive this reader", result);
}

async function fifoDescriptor(eof) {
  const session = await start("fifo-fd", "stdin-echo.sh", [], "stdin repl ready");
  for (const line of ["before-reload", "after-first-restore", "after-second-restore"]) {
    if (line !== "before-reload") {
      await detach(session);
      log("EXPLICIT EXCEPTION: kernel FIFO descriptor remains open; only its integer/dev/inode are serialized", session.record.descriptor);
      await restore(session);
    }
    assert.equal(session.manager.write(`${line}\n`).ok, true);
    await contains(session.record.stdoutFile, `echo:${line}`);
  }
  assert.equal(session.manager.write(eof ? "" : "quit\n", eof).ok, true);
  await contains(session.record.stdoutFile, eof ? "stdin closed" : "goodbye");
  await waitForDead(session.record.pid);
  log("OBSERVED: stdin works without supervisor/socket, BUT requires a kernel FD kept open in this same Node process");
}

async function descriptorReuse() {
  const session = await start("fifo-fd", "stdin-echo.sh", [], "stdin repl ready");
  await detach(session);
  log(`close serialized descriptor ${session.record.descriptor.fd} to simulate a stale FD`);
  closeSync(session.record.descriptor.fd);
  await waitForDead(session.record.pid);
  await assert.rejects(() => restore(session), /EBADF/);
  // Avoid cleanup attempting to close an already-closed descriptor.
  delete session.record.descriptor;
  log("ASSERT: restore rejects a closed descriptor rather than blindly using its integer");
}

const probes = [
  ["baseline", baseline],
  ["continuous", () => output("continuous-output.sh", "ping ", null)],
  ["mixed-output", () => output("combo-output.sh", "stdout: message ", "stderr: warning ")],
  ["watcher", watcher],
  ["clean-exit", () => completed(false)],
  ["failure", () => completed(true)],
  ["group-sigkill", crashed],
  ["fifo-path", fifoPath],
  ["fifo-fd-quit", () => fifoDescriptor(false)],
  ["fifo-fd-eof", () => fifoDescriptor(true)],
  ["closed-fd", descriptorReuse],
];

console.log(`Same-process reload probes: host PID ${hostPid}; artifacts ${root}`);
console.log("No supervisor, socket, controller subprocess, or retained JS manager/child/stream reference.");
console.log("fifo-fd cases deliberately retain an OS descriptor, explicitly NOT a file-path-only solution.");
try {
  if (selection) assert(probes.some(([probe]) => probe === selection), `Unknown probe ${selection}`);
  for (const [probe, run] of probes) {
    if (selection && selection !== probe) continue;
    name = probe;
    console.log(`\n===== ${name} =====`);
    await run();
    log("CHECKS PASSED; observations/limitations above are the result, NOT proof of full restoration");
  }
} finally {
  name = "cleanup";
  for (const session of sessions) {
    if (alive(session.record.pid)) process.kill(-session.record.pid, "SIGKILL");
    await waitForDead(session.record.pid);
    if (session.manager) session.manager.shutdown();
    else if (session.record.descriptor) {
      const { fd, dev, ino } = session.record.descriptor;
      const stat = fstatSync(fd);
      assert.equal(stat.dev, dev); assert.equal(stat.ino, ino);
      closeSync(fd);
    }
  }
  if (keep) log(`retained ${root}; workloads stopped`);
  else { rmSync(root, { recursive: true, force: true }); log(`removed ${root}`); }
}
