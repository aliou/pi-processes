import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import type {
  AdoptProcessOptions,
  KillResult,
  ManagerEvent,
  ProcessInfo,
  WriteResult,
} from "../types";
import type {
  LogMatcherSpec,
  ProcessListEntry,
  ProcessWakeConditions,
  ProcessWakeConfig,
  WatchRemoveSpec,
  WatchState,
  WatchUpdateResult,
} from "../wake";
import { formatProcess } from "./internal-types";
import { ProcessLogStore } from "./process-log-store";
import { ProcessOutput } from "./process-output";
import { ProcessRegistry } from "./process-registry";
import { ProcessRuntimeController } from "./process-runtime-controller";
import { ProcessWakeController } from "./process-wake";

interface ProcessManagerOptions {
  getConfiguredShellPath?: () => string | undefined;
}

export class ProcessManager {
  private events = new EventEmitter();

  private registry: ProcessRegistry;
  private logStore: ProcessLogStore;
  private output: ProcessOutput;
  private runtime: ProcessRuntimeController;
  private wake: ProcessWakeController;

  constructor(options?: ProcessManagerOptions) {
    const emit = (event: ManagerEvent): void => {
      if (event.type === "process_output_changed") {
        this.wake.handleOutputChanged(event);
      }
      this.events.emit("event", event);
      if (event.type === "process_ended") {
        const { id } = event.info;
        queueMicrotask(() => this.wake.handleProcessEnded(id));
      }
    };

    this.registry = new ProcessRegistry();
    this.logStore = new ProcessLogStore();

    this.output = new ProcessOutput({
      emit,
      logStore: this.logStore,
    });

    this.wake = new ProcessWakeController({
      emit,
      registry: this.registry,
    });

    this.runtime = new ProcessRuntimeController({
      registry: this.registry,
      logs: this.logStore,
      output: this.output,
      emit,
      getConfiguredShellPath:
        options?.getConfiguredShellPath ?? (() => undefined),
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

  listWithWake(): ProcessListEntry[] {
    return this.wake.listWithWake();
  }

  get(id: string): ProcessInfo | null {
    return this.registry.getPublicInfo(id);
  }

  getWakeConditions(processId: string): ProcessWakeConditions | null {
    return this.wake.getWakeConditions(processId);
  }

  getWakeConfig(processId: string): ProcessWakeConfig | null {
    return this.wake.getWakeConfig(processId);
  }

  registerWakeConfig(processId: string, config: ProcessWakeConfig): void {
    this.wake.registerWakeConfig(processId, config);
  }

  clearWakeConfig(processId: string): void {
    this.wake.clearWakeConfig(processId);
  }

  getWatchState(processId: string): WatchState | null {
    return this.wake.getWatchState(processId);
  }

  appendWatches(
    processId: string,
    items: LogMatcherSpec[],
  ): WatchUpdateResult | null {
    return this.wake.appendWatches(processId, items);
  }

  replaceWatches(
    processId: string,
    items: LogMatcherSpec[],
  ): WatchUpdateResult | null {
    return this.wake.replaceWatches(processId, items);
  }

  removeWatches(
    processId: string,
    specs: WatchRemoveSpec[],
  ): WatchUpdateResult | null {
    return this.wake.removeWatches(processId, specs);
  }

  clearWatches(processId: string): WatchUpdateResult | null {
    return this.wake.clearWatches(processId);
  }

  markIntentionalStop(processId: string): void {
    this.wake.markIntentionalStop(processId);
  }

  consumeIntentionalStop(processId: string): boolean {
    return this.wake.consumeIntentionalStop(processId);
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
    this.wake.clear();
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
  WatchMatch,
  WriteResult,
} from "../types";
export type {
  LogMatcherSpec,
  ProcessListEntry,
  ProcessWakeConditions,
  ProcessWakeConfig,
  ProcessWakeWatch,
  WatchMeta,
  WatchRemoveSpec,
  WatchState,
  WatchUpdateResult,
} from "../wake";
