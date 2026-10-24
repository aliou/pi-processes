import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import type {
  AdoptProcessOptions,
  KillResult,
  ManagerEvent,
  ProcessInfo,
  WriteResult,
} from "../types";
import { isProcessGroupAlive, killProcessGroup } from "../utils";
import {
  isPidAlive,
  type ProcessIdentityReader,
  procfsIdentity,
} from "../utils/proc-identity";
import { formatProcess } from "./internal-types";
import {
  type OrphanReapReport,
  OrphanRecordStore,
  reapOrphanedRecords,
  removeOrphanLogDir,
} from "./orphan-recovery";
import { ProcessLogStore } from "./process-log-store";
import { ProcessOutput } from "./process-output";
import { ProcessRegistry } from "./process-registry";
import {
  type OrphanRecoveryContext,
  ProcessRuntimeController,
} from "./process-runtime-controller";

interface ProcessManagerOptions {
  getConfiguredShellPath?: () => string | undefined;
  orphanRecords?: {
    dir: string;
    identity?: ProcessIdentityReader;
  };
}

export class ProcessManager {
  private events = new EventEmitter();

  private registry: ProcessRegistry;
  private logStore: ProcessLogStore;
  private output: ProcessOutput;
  private runtime: ProcessRuntimeController;
  private orphans: OrphanRecoveryContext | null;

  constructor(options?: ProcessManagerOptions) {
    const emit = (event: ManagerEvent): void => {
      this.events.emit("event", event);
    };

    this.registry = new ProcessRegistry();
    this.logStore = new ProcessLogStore();

    this.output = new ProcessOutput({
      emit,
      logStore: this.logStore,
    });

    this.orphans = createOrphanRecoveryContext(options?.orphanRecords);

    this.runtime = new ProcessRuntimeController({
      registry: this.registry,
      logs: this.logStore,
      output: this.output,
      emit,
      getConfiguredShellPath:
        options?.getConfiguredShellPath ?? (() => undefined),
      orphans: this.orphans,
    });
  }

  onEvent(listener: (event: ManagerEvent) => void): () => void {
    this.events.on("event", listener);
    return () => this.events.off("event", listener);
  }

  start(
    name: string,
    command: string,
    cwd: string,
    env?: NodeJS.ProcessEnv,
  ): ProcessInfo {
    const managed = this.runtime.start(name, command, cwd, env);
    return formatProcess(managed);
  }

  /**
   * Adopt an externally spawned child process. The child must run in a
   * detached process group with piped stdio (see
   * ProcessRuntimeController.adopt for the full contract).
   */
  adopt(
    name: string,
    command: string,
    cwd: string,
    child: ChildProcess,
    opts?: AdoptProcessOptions,
  ): ProcessInfo {
    const managed = this.runtime.adopt(name, command, cwd, child, opts);
    return formatProcess(managed);
  }

  list(): ProcessInfo[] {
    return this.registry.list();
  }

  get(id: string): ProcessInfo | null {
    return this.registry.getPublicInfo(id);
  }

  rename(id: string, name: string): ProcessInfo | null {
    const info = this.registry.rename(id, name);
    if (info) {
      this.events.emit("event", {
        type: "processes_changed",
      } satisfies ManagerEvent);
    }
    return info;
  }

  getOutput(
    id: string,
    tailLines = 100,
  ): { stdout: string[]; stderr: string[]; status: string } | null {
    const managed = this.registry.getRecord(id);
    if (!managed) return null;

    return {
      stdout: this.logStore.readTailLines(managed.stdoutFile, tailLines),
      stderr: this.logStore.readTailLines(managed.stderrFile, tailLines),
      status: managed.status,
    };
  }

  getCombinedOutput(
    id: string,
    tailLines = 100,
  ): Array<{ type: "stdout" | "stderr"; text: string }> | null {
    const managed = this.registry.getRecord(id);
    if (!managed) return null;
    return this.logStore.getCombinedOutput(managed.combinedFile, tailLines);
  }

  /**
   * Return output capped at 16 MiB per stream. Use getLogFiles() and stream
   * the returned paths when an exact, unbounded read is required.
   */
  getFullOutput(id: string): { stdout: string; stderr: string } | null {
    const managed = this.registry.getRecord(id);
    if (!managed) return null;
    return {
      stdout: this.logStore.readFullFile(managed.stdoutFile),
      stderr: this.logStore.readFullFile(managed.stderrFile),
    };
  }

  getLogFiles(
    id: string,
  ): { stdoutFile: string; stderrFile: string; combinedFile: string } | null {
    const managed = this.registry.getRecord(id);
    if (!managed) return null;
    return {
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
      combinedFile: managed.combinedFile,
    };
  }

  getFileSize(id: string): { stdout: number; stderr: number } | null {
    const managed = this.registry.getRecord(id);
    if (!managed) return null;
    return this.logStore.getFileSize({
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
      combinedFile: managed.combinedFile,
    });
  }

  async kill(
    id: string,
    opts?: { signal?: NodeJS.Signals; timeoutMs?: number },
  ): Promise<KillResult> {
    return this.runtime.kill(id, opts);
  }

  writeToStdin(
    id: string,
    data: string,
    opts?: { end?: boolean },
  ): WriteResult {
    return this.runtime.writeToStdin(id, data, opts);
  }

  killAll(): void {
    this.runtime.killAll();
  }

  reapOrphanedProcesses(): OrphanReapReport {
    const orphans = this.orphans;
    if (!orphans) {
      return { killed: [], discarded: [], kept: 0 };
    }
    return reapOrphanedRecords(orphans.store, {
      identity: {
        bootId: () => orphans.host.bootId,
        processStartTime: orphans.childStartTime,
      },
      isPidAlive,
      isGroupAlive: isProcessGroupAlive,
      killGroup: (pgid) => {
        killProcessGroup(pgid, "SIGKILL");
      },
      removeLogDir: removeOrphanLogDir,
    });
  }

  clearFinished(): number {
    return this.runtime.clearFinished();
  }

  stopWatcher(): void {
    this.runtime.stopWatcher();
  }

  cleanup(): void {
    this.runtime.beginShutdown();
    this.runtime.stopWatcher();
    this.output.clearAll();
    this.runtime.killAllLive();
    this.orphans?.store.removeWritten();
    this.logStore.cleanup();
  }

  [Symbol.dispose](): void {
    this.cleanup();
  }
}

export type {
  KillResult,
  ManagerEvent,
  ProcessInfo,
  ProcessStatus,
  WriteResult,
} from "../types";

function createOrphanRecoveryContext(
  options?: ProcessManagerOptions["orphanRecords"],
): OrphanRecoveryContext | null {
  if (!options) return null;

  const identity = options.identity ?? procfsIdentity;
  const bootId = identity.bootId();
  if (bootId === null) return null;

  const hostStartTimeTicks = identity.processStartTime(process.pid);
  if (hostStartTimeTicks === null) return null;

  return {
    store: new OrphanRecordStore(options.dir),
    host: { bootId, pid: process.pid, startTimeTicks: hostStartTimeTicks },
    childStartTime: identity.processStartTime,
  };
}
