import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { ProcessLogStore } from "../../src/manager/process-log-store";
import {
  resolveShellExecutable,
  spawnCommand,
} from "../../src/utils/command-executor";
import {
  isProcessGroupAlive,
  killProcessGroup,
} from "../../src/utils/process-group";

export type StdioMode =
  | "pipes"
  | "files"
  | "fifo-path"
  | "fifo-fd"
  | "fifo-stdio";

interface FifoDescriptor {
  fd: number;
  dev: number;
  ino: number;
}

export interface Snapshot {
  version: 1;
  hostPid: number;
  id: string;
  pid: number;
  command: string;
  cwd: string;
  mode: StdioMode;
  stdoutFile: string;
  stderrFile: string;
  fifoPath?: string;
  descriptor?: FifoDescriptor;
  outputDescriptors?: { stdout: FifoDescriptor; stderr: FifoDescriptor };
}

interface ObservedExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

// Probe-only manager. Production ProcessManager has no public detach/restore
// API. The pipes case uses its existing spawnCommand primitive; the other
// cases explore file/FIFO stdio without changing src or retaining JS handles.
export class ProbeManager {
  private record: Snapshot | null;
  private child: ChildProcess | null = null;
  private observedExit: ObservedExit | null = null;
  private captureLogs: ProcessLogStore | null = null;

  constructor(snapshot: Snapshot | null = null) {
    if (snapshot && snapshot.hostPid !== process.pid) {
      throw new Error("This experiment only restores inside the SAME Node PID");
    }
    this.record = snapshot;
    this.validateDescriptor();
    if (snapshot?.outputDescriptors) this.openCaptureLogs(snapshot);
  }

  start(command: string, cwd: string, mode: StdioMode): Snapshot {
    if (this.record) throw new Error("One workload per probe manager");
    const stdoutFile = join(cwd, "stdout.log");
    const stderrFile = join(cwd, "stderr.log");
    appendFileSync(stdoutFile, "");
    appendFileSync(stderrFile, "");
    const record: Snapshot = {
      version: 1,
      hostPid: process.pid,
      id: `probe_${randomUUID()}`,
      pid: -1,
      command,
      cwd,
      mode,
      stdoutFile,
      stderrFile,
    };
    this.record = record;
    if (mode === "fifo-stdio") this.openCaptureLogs(record);
    this.child = this.launch(record);
    record.pid = this.child.pid ?? -1;
    if (record.pid <= 0) throw new Error("Workload did not start");
    this.child.unref();
    this.child.on("error", (error) => {
      appendFileSync(stderrFile, `spawn error: ${error.message}\n`);
    });
    this.child.on("close", (exitCode, signal) => {
      this.observedExit = { exitCode, signal };
    });
    return structuredClone(record);
  }

  inspect() {
    const record = this.requireRecord();
    return {
      ...structuredClone(record),
      alive: isProcessGroupAlive(record.pid),
      // Restored managers never inherit the old manager's close callback.
      exitCode: this.observedExit?.exitCode ?? null,
      signal: this.observedExit?.signal ?? null,
      outcomeKnown: this.observedExit !== null,
      attachedChildObject: this.child !== null,
      stdout: readFileSync(record.stdoutFile, "utf8"),
      stderr: readFileSync(record.stderrFile, "utf8"),
    };
  }

  detach(): Snapshot {
    const record = this.requireRecord();
    if (this.child) {
      // Remove EVERY callback owned by this generation before dropping it.
      this.child.removeAllListeners();
      for (const stream of [
        this.child.stdin,
        this.child.stdout,
        this.child.stderr,
      ]) {
        stream?.removeAllListeners();
        stream?.destroy();
      }
      this.child = null;
    }
    this.observedExit = null;
    this.captureLogs = null;
    if (record.mode === "fifo-path") this.closeDescriptor();
    const snapshot = structuredClone(record);
    // No child, stream, callback, buffer, or record remains in this instance.
    this.record = null;
    return snapshot;
  }

  write(input: string, end = false): { ok: boolean; reason?: string } {
    const record = this.requireRecord();
    if (!isProcessGroupAlive(record.pid))
      return { ok: false, reason: "process_exited" };
    if (this.child?.stdin) {
      this.child.stdin.write(input);
      if (end) this.child.stdin.end();
      return { ok: true };
    }
    if (record.descriptor) {
      this.validateDescriptor();
      if (input) writeSync(record.descriptor.fd, input);
      if (end) this.closeDescriptor();
      return { ok: true };
    }
    if (record.fifoPath) {
      // Never block waiting for a vanished reader. This tests path-only
      // reopen, not an implicit keepalive handle hidden in the host.
      let fd: number;
      try {
        fd = openSync(
          record.fifoPath,
          constants.O_WRONLY | constants.O_NONBLOCK,
        );
      } catch (error) {
        return { ok: false, reason: (error as NodeJS.ErrnoException).code };
      }
      try {
        writeSync(fd, input);
      } finally {
        closeSync(fd);
      }
      return { ok: true };
    }
    return { ok: false, reason: "no_restorable_stdin" };
  }

  stop(signal: NodeJS.Signals = "SIGTERM"): void {
    killProcessGroup(this.requireRecord().pid, signal);
  }

  capture(): number {
    const record = this.requireRecord();
    if (!record.outputDescriptors || !this.captureLogs) return 0;
    this.validateDescriptor();
    const buffer = Buffer.alloc(512);
    let total = 0;
    for (const stream of ["stdout", "stderr"] as const) {
      // Bounded work per call; neither stream may starve the other.
      for (let chunk = 0; chunk < 32; chunk++) {
        let length: number;
        try {
          length = readSync(record.outputDescriptors[stream].fd, buffer);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EAGAIN") break;
          throw error;
        }
        if (!length) break;
        const bytes = buffer.subarray(0, length);
        if (stream === "stdout")
          this.captureLogs.appendStdout(record.stdoutFile, bytes);
        else this.captureLogs.appendStderr(record.stderrFile, bytes);
        total += length;
      }
    }
    return total;
  }

  shutdown(): void {
    const record = this.requireRecord();
    if (isProcessGroupAlive(record.pid)) this.stop("SIGKILL");
    this.closeDescriptor();
    if (record.outputDescriptors) {
      this.validateDescriptor();
      for (const descriptor of Object.values(record.outputDescriptors))
        closeSync(descriptor.fd);
      delete record.outputDescriptors;
    }
    this.detach();
  }

  private launch(record: Snapshot): ChildProcess {
    if (record.mode === "pipes") {
      const child = spawnCommand(record.command, record.cwd);
      child.stdout?.on("data", (bytes) =>
        appendFileSync(record.stdoutFile, bytes),
      );
      child.stderr?.on("data", (bytes) =>
        appendFileSync(record.stderrFile, bytes),
      );
      return child;
    }
    const stdout =
      record.mode === "fifo-stdio"
        ? this.createOutputFifo(record, "stdout")
        : openSync(record.stdoutFile, "a");
    const stderr =
      record.mode === "fifo-stdio"
        ? this.createOutputFifo(record, "stderr")
        : openSync(record.stderrFile, "a");
    let stdin: number | "ignore" = "ignore";
    try {
      if (record.mode.startsWith("fifo-")) stdin = this.createFifo(record);
      const shell = resolveShellExecutable({
        knownPaths: [
          "/run/current-system/sw/bin/bash",
          "/bin/bash",
          "/usr/bin/bash",
        ],
      });
      return spawn(shell, ["-c", record.command], {
        cwd: record.cwd,
        detached: true,
        stdio: [stdin, stdout, stderr],
      });
    } finally {
      closeSync(stdout);
      closeSync(stderr);
      if (typeof stdin === "number") closeSync(stdin);
    }
  }

  private createFifo(record: Snapshot): number {
    record.fifoPath = join(record.cwd, "stdin.fifo");
    // Short-lived utility, NOT a resident supervisor or input relay.
    execFileSync("mkfifo", [record.fifoPath]);
    const fd = openSync(record.fifoPath, constants.O_RDWR);
    const { dev, ino } = fstatSync(fd);
    record.descriptor = { fd, dev, ino };
    // Command gets only a READ end. Otherwise its own writer prevents EOF.
    return openSync(record.fifoPath, constants.O_RDONLY);
  }

  private validateDescriptor(): void {
    const descriptors = [
      this.record?.descriptor,
      ...Object.values(this.record?.outputDescriptors ?? {}),
    ];
    for (const descriptor of descriptors) {
      if (!descriptor) continue;
      const stat = fstatSync(descriptor.fd);
      if (
        !stat.isFIFO() ||
        stat.dev !== descriptor.dev ||
        stat.ino !== descriptor.ino
      ) {
        throw new Error("Serialized FD no longer points to the expected FIFO");
      }
    }
  }

  private openCaptureLogs(record: Snapshot): void {
    // Small test cap so the burst can prove truncation without megabytes of IO.
    this.captureLogs = new ProcessLogStore(record.cwd, { maxFileBytes: 4096 });
    const paths = this.captureLogs.createLogs("capture");
    record.stdoutFile = paths.stdoutFile;
    record.stderrFile = paths.stderrFile;
  }

  private createOutputFifo(
    record: Snapshot,
    stream: "stdout" | "stderr",
  ): number {
    const path = join(record.cwd, `${stream}.fifo`);
    execFileSync("mkfifo", [path]);
    const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
    const { dev, ino } = fstatSync(fd);
    const descriptor = { fd, dev, ino };
    record.outputDescriptors ??= {} as NonNullable<
      Snapshot["outputDescriptors"]
    >;
    record.outputDescriptors[stream] = descriptor;
    // Child gets a blocking WRITE end, not the parent's nonblocking read end.
    return openSync(path, constants.O_WRONLY);
  }

  private closeDescriptor(): void {
    const descriptor = this.record?.descriptor;
    if (!descriptor) return;
    this.validateDescriptor();
    closeSync(descriptor.fd);
    delete this.requireRecord().descriptor;
  }

  private requireRecord(): Snapshot {
    if (!this.record) throw new Error("Manager is empty or detached");
    return this.record;
  }
}
