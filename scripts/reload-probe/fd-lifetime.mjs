import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, statSync, watch, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = mkdtempSync(join(tmpdir(), "fifo-exit-"));
const keep = process.argv.includes("--keep");
const ownerScript = fileURLToPath(new URL("./fd-owner.mjs", import.meta.url));
const fixtures = fileURLToPath(new URL("../../tests/e2e/scripts/", import.meta.url));
const subjects = [];
let caseName = "setup";

function log(message, value) {
  console.log(`[${caseName}] ${message}`);
  if (value !== undefined) console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

async function waitForGroupExit(pid) {
  const deadline = Date.now() + 5000;
  while (groupAlive(pid)) {
    assert(Date.now() < deadline, `Workload group ${pid} did not exit`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForText(path, expected) {
  return new Promise((resolve, reject) => {
    let done = false;
    const watcher = watch(dirname(path), check);
    const interval = setInterval(check, 25);
    const timeout = setTimeout(() => finish(new Error(`Missing ${expected} in ${path}`)), 10_000);
    function finish(error) {
      if (done) return;
      done = true;
      watcher.close(); clearInterval(interval); clearTimeout(timeout);
      if (error) reject(error); else resolve();
    }
    function check() {
      if (!existsSync(path)) return;
      if (readFileSync(path, "utf8").includes(expected)) finish();
    }
    check();
  });
}

function readOwnerRecord(child) {
  return new Promise((resolve, reject) => {
    let text = "";
    const timeout = setTimeout(() => finish(new Error("Owner readiness timeout")), 10_000);
    function finish(error, record) {
      clearTimeout(timeout);
      child.stdout.off("data", data);
      child.off("exit", exited);
      if (error) reject(error); else resolve(record);
    }
    function data(bytes) {
      text += bytes.toString("utf8");
      const line = text.split("\n").find((line) => line.startsWith("OWNER_RECORD "));
      if (!text.endsWith("\n") || !line) return;
      try { finish(null, JSON.parse(line.slice("OWNER_RECORD ".length))); }
      catch (error) { finish(error); }
    }
    function exited(code, signal) { finish(new Error(`Owner exited before readiness: ${code}/${signal}`)); }
    child.stdout.on("data", data);
    child.once("exit", exited);
  });
}

async function lsof(args) {
  // Linux hosts with container mounts can warn about unrelated filesystems.
  // Require positive matches before exit and independently verify owner death.
  const query = ["-w", ...args];
  log(`external OS query: lsof ${query.join(" ")}`);
  try {
    const { stdout } = await exec("lsof", query);
    log("lsof output:", stdout.trim());
    return stdout;
  } catch (error) {
    // lsof exits 1 when the selected process/FD has no open-file entry.
    if (error.code !== 1) throw error;
    assert.equal(error.stderr.trim(), "", "lsof must not fail because of permissions or invalid arguments");
    assert.equal(error.stdout.trim(), "", "Expected no matching open descriptor");
    log("lsof: no matching open descriptor (exit 1)");
    return "";
  }
}

async function runCase(fixture, killOwner) {
  const cwd = join(root, caseName);
  mkdirSync(cwd);
  copyFileSync(join(fixtures, fixture), join(cwd, fixture));
  log(`observer PID=${process.pid}; start owner test subject: ${process.execPath} ${ownerScript} ${cwd} ${fixture}`);
  const owner = spawn(process.execPath, [ownerScript, cwd, fixture], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const subject = { owner, record: null };
  subjects.push(subject);
  const record = await readOwnerRecord(owner);
  subject.record = record;
  assert.equal(owner.pid, record.hostPid);
  const ready = fixture === "stdin-echo.sh" ? "stdin repl ready" : "ping 0";
  await waitForText(record.stdoutFile, ready);
  const { fd, dev, ino } = record.descriptor;
  log(`OWNER PID=${record.hostPid}, FD=${fd}, FIFO dev=${dev}, inode=${ino}, path=${record.fifoPath}`);
  log(`WORKLOAD PID/PGID=${record.pid}; only its read end should survive owner death`);
  const metadata = statSync(record.fifoPath);
  assert(metadata.isFIFO());
  assert.equal(metadata.dev, dev); assert.equal(metadata.ino, ino);

  const ownerArgs = ["-nP", "-a", "-p", String(record.hostPid), "-d", String(fd)];
  const before = await lsof(ownerArgs);
  assert(before.trim(), "OS must show the owner's numeric descriptor BEFORE exit");
  const rows = before.trim().split("\n").slice(1);
  assert(rows.some((row) => {
    const columns = row.trim().split(/\s+/);
    return Number(columns[1]) === record.hostPid && columns[3] === `${fd}u` && row.includes("FIFO");
  }), "Owner FD must be the FIFO opened read/write, not some unrelated descriptor");
  const childBefore = await lsof(["-nP", "-a", "-p", String(record.pid), "-d", "0"]);
  assert(childBefore.includes("0r") && childBefore.includes("FIFO"), "Command stdin must be a read-only FIFO");

  const closed = once(owner, "close");
  if (killOwner) {
    log(`SIGKILL ONLY owner PID ${record.hostPid}; NOT workload group ${record.pid}`);
    owner.kill("SIGKILL");
  } else {
    log("request process.exit(0) in owner; no explicit FIFO close or workload cleanup");
    writeFileSync(join(cwd, "exit-now"), "");
  }
  const [code, signal] = await closed;
  assert.equal(code, killOwner ? null : 0);
  assert.equal(signal, killOwner ? "SIGKILL" : null);
  assert.equal(pidAlive(record.hostPid), false);
  log(`owner has exited: code=${code}, signal=${signal}; PID no longer exists`);

  // Observations happen BEFORE any observer cleanup. The observer never
  // opened the FIFO and could not close the dead owner's process-local FD.
  assert.equal(await lsof(ownerArgs), "");
  assert.equal(existsSync(record.fifoPath), true);
  assert(statSync(record.fifoPath).isFIFO());
  log("CONFIRMED: owner's (PID, FD) entry is gone; FIFO filesystem path still exists");

  if (fixture === "stdin-echo.sh") {
    await waitForText(record.stdoutFile, "stdin closed");
    await waitForGroupExit(record.pid);
    assert.equal(await lsof(["-nP", record.fifoPath]), "");
    log("CONFIRMED: no open handles remain on FIFO; stdin-echo received EOF and exited", readFileSync(record.stdoutFile, "utf8"));
  } else {
    assert.equal(groupAlive(record.pid), true);
    const after = await lsof(["-nP", "-a", "-p", String(record.pid), "-d", "0"]);
    assert(after.includes("0r") && after.includes("FIFO"));
    log("CONFIRMED: owner FD is gone BUT continuous-output workload survived; its own FIFO read handle remains");
  }
  log(`Evidence saved in ${join(cwd, "owner.json")}; repeat the printed lsof command after this script exits`);
}

console.log(`Whole-process FD lifetime probe. Observer PID=${process.pid}, artifacts=${root}`);
console.log("Observer is test instrumentation, NOT a supervisor. It never owns/writes the FIFO.");
try {
  for (const [label, fixture, kill] of [
    ["normal-exit", "stdin-echo.sh", false],
    ["sigkill-eof", "stdin-echo.sh", true],
    ["sigkill-orphan", "continuous-output.sh", true],
  ]) {
    caseName = label;
    console.log(`\n===== ${label} =====`);
    await runCase(fixture, kill);
  }
} finally {
  caseName = "cleanup";
  for (const { owner, record } of subjects) {
    if (owner.exitCode === null && owner.signalCode === null) {
      const closed = once(owner, "close");
      owner.kill("SIGKILL");
      await closed;
    }
    const saved = record ?? (existsSync(join(owner.spawnargs[2], "owner.json"))
      ? JSON.parse(readFileSync(join(owner.spawnargs[2], "owner.json"), "utf8")) : null);
    if (!saved) continue;
    if (groupAlive(saved.pid)) {
      log(`now clean orphan workload group ${saved.pid}, AFTER recording observations`);
      process.kill(-saved.pid, "SIGKILL");
    }
    await waitForGroupExit(saved.pid);
  }
  if (keep) log(`retained artifacts ${root}; no probe owners or workloads remain`);
  else { rmSync(root, { recursive: true, force: true }); log(`removed ${root}`); }
}
