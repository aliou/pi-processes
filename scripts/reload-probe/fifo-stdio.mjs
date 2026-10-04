import assert from "node:assert/strict";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadManager } from "./bootstrap.mjs";

const cwd = mkdtempSync(join(tmpdir(), "fifo-stdio-"));
const hostPid = process.pid;
const keep = process.argv.includes("--keep");
copyFileSync(fileURLToPath(new URL("../../tests/e2e/scripts/burst-output.sh", import.meta.url)), join(cwd, "burst-output.sh"));
chmodSync(join(cwd, "burst-output.sh"), 0o755);
let manager = new (await loadManager()).ProbeManager();
let record;

function log(message, data) {
  console.log(`[fifo-stdio PID=${process.pid}] ${message}`);
  if (data !== undefined) console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function until(predicate, description, capture = false) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    assert(Date.now() < deadline, `Timeout: ${description}`);
    if (capture) {
      manager.capture();
      assert(statSync(record.stdoutFile).size <= 4096);
      assert(statSync(record.stderrFile).size <= 4096);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function discard() {
  const weak = new WeakRef(manager);
  const snapshot = manager.detach();
  writeFileSync(join(cwd, "state.json"), JSON.stringify(snapshot, null, 2));
  manager = null;
  record = JSON.parse(readFileSync(join(cwd, "state.json"), "utf8"));
  return weak;
}

function workloadAlive() {
  try { process.kill(-record.pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function assertCollected(weak) {
  await nextTurn();
  if (global.gc) {
    global.gc(); await nextTurn(); global.gc();
    assert.equal(weak.deref(), undefined);
    log("old manager collected; ONLY three OS FIFO descriptors remain open");
  } else log("GC collection assertion not run (use --expose-gc)");
}

try {
  log(`platform=${process.platform}, arch=${process.arch}, Node=${process.version}`);
  log("TEST CAP = 4096 bytes. ProcessLogStore's existing marker text says 64 MB; assertions use actual file sizes, not that text.");
  record = manager.start("exec bash ./burst-output.sh", cwd, "fifo-stdio");
  log("fixture is direct child/group leader; no supervisor or socket", record);
  await until(() => readFileSync(record.stdoutFile, "utf8").includes("burst ready"), "initial captured output", true);
  await assertCollected(discard());
  const sizes = [statSync(record.stdoutFile).size, statSync(record.stderrFile).size];
  writeFileSync(join(cwd, "release-burst"), "");
  await until(() => existsSync(join(cwd, "burst-started")), "fixture started burst with no manager");
  assert.equal(manager, null);
  assert.deepEqual([statSync(record.stdoutFile).size, statSync(record.stderrFile).size], sizes);
  log("no manager running: log files did not grow; bytes go into bounded kernel FIFOs, not uncapped files");
  log(`burst finished yet? ${existsSync(join(cwd, "burst-finished"))} (not used as an exit-status claim)`);
  const snapshot = JSON.parse(readFileSync(join(cwd, "state.json"), "utf8"));
  manager = new (await loadManager()).ProbeManager(snapshot);
  assert.equal(process.pid, hostPid);
  log("fresh manager loaded in SAME PID and now drains original FIFO descriptors");
  await until(() => {
    const stdout = readFileSync(record.stdoutFile, "utf8");
    const stderr = readFileSync(record.stderrFile, "utf8");
    return stdout.includes("stdout burst complete") && stderr.includes("stderr burst complete");
  }, "both final markers captured", true);
  const stdout = readFileSync(record.stdoutFile, "utf8");
  const stderr = readFileSync(record.stderrFile, "utf8");
  assert(stdout.includes("[log truncated"));
  assert(stderr.includes("[log truncated"));
  assert(statSync(record.stdoutFile).size <= 4096);
  assert(statSync(record.stderrFile).size <= 4096);
  log("CONFIRMED: backlog drained; both log caps held at every capture; both final markers arrived", {
    stdoutBytes: statSync(record.stdoutFile).size,
    stderrBytes: statSync(record.stderrFile).size,
    stdoutTail: stdout.slice(-90), stderrTail: stderr.slice(-90),
  });
  log("Exit status remains unknown after detach; this is not an exit-code recovery test");
  manager.shutdown();
  await until(() => !workloadAlive(), "burst group cleanup");
  manager = null;
  record = null;

  for (const failure of [false, true]) {
    const fixture = failure ? "crash-on-file.sh" : "wait-for-file.sh";
    const directory = join(cwd, failure ? "finished-failure" : "finished-success");
    mkdirSync(directory);
    copyFileSync(fileURLToPath(new URL(`../../tests/e2e/scripts/${fixture}`, import.meta.url)), join(directory, fixture));
    manager = new (await loadManager()).ProbeManager();
    record = manager.start(`exec bash ./${fixture}`, directory, "fifo-stdio");
    const ready = failure ? "worker waiting for crash-now" : "waiting for release-output";
    await until(() => readFileSync(record.stdoutFile, "utf8").includes(ready), "fixture ready", true);
    await assertCollected(discard());
    writeFileSync(join(directory, failure ? "crash-now" : "release-output"), "");
    await until(() => !workloadAlive(), "command exits WHILE no manager exists");
    assert.equal(manager, null);
    log(`${fixture} has already exited; its last bytes are still in the OS FIFO queues`);
    manager = new (await loadManager()).ProbeManager(JSON.parse(readFileSync(join(cwd, "state.json"), "utf8")));
    const expected = failure ? "fatal: marker crash-now detected" : "dynamic ready";
    const file = failure ? record.stderrFile : record.stdoutFile;
    await until(() => readFileSync(file, "utf8").includes(expected), "queued output recovered from DEAD command", true);
    const info = manager.inspect();
    assert.equal(info.alive, false);
    assert.equal(info.outcomeKnown, false);
    assert.equal(info.exitCode, null);
    log("CONFIRMED: output recovered after death, actual exit code NOT recovered", {
      stdout: info.stdout, stderr: info.stderr, outcomeKnown: info.outcomeKnown,
    });
    manager.shutdown();
    manager = null;
    record = null;
  }
} finally {
  if (manager && record) manager.shutdown();
  else if (record) {
    manager = new (await loadManager()).ProbeManager(record);
    manager.shutdown();
  }
  if (record) {
    await until(() => !workloadAlive(), "workload group cleanup");
  }
  if (keep) log(`retained ${cwd}; workload stopped and descriptors closed`);
  else { rmSync(cwd, { recursive: true, force: true }); log("workload and descriptors cleaned; files removed"); }
}
