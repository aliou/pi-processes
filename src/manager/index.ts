import { EventEmitter } from "node:events";

import type {
  AddLogWatchesResult,
  KillResult,
  LogWatch,
  ManagerEvent,
  ProcessInfo,
  StartOptions,
  WriteResult,
} from "../types";
import { OutputChangeNotifier } from "./output-change-notifier";
import { ProcessLogStore } from "./process-log-store";
import { ProcessOutputTracker } from "./process-output-tracker";
import { ProcessRegistry } from "./process-registry";
import { ProcessRuntimeController } from "./process-runtime-controller";

interface ProcessManagerOptions {
  getConfiguredShellPath?: () => string | undefined;
}

export class ProcessManager {
  private events = new EventEmitter();

  private registry: ProcessRegistry;
  private logs: ProcessLogStore;
  private outputTracker: ProcessOutputTracker;
  private outputNotifier: OutputChangeNotifier;
  private runtime: ProcessRuntimeController;

  constructor(options?: ProcessManagerOptions) {
    const emit = (event: ManagerEvent): void => {
      this.events.emit("event", event);
    };

    this.registry = new ProcessRegistry();
    this.logs = new ProcessLogStore();

    this.outputTracker = new ProcessOutputTracker({
      emit,
      appendCombinedLine: (file, source, line) =>
        this.logs.appendCombinedLine(file, source, line),
    });

    this.outputNotifier = new OutputChangeNotifier({
      emit,
      getAppendedLines: (id) => {
        const managed = this.registry.getRecord(id);
        return managed
          ? this.outputTracker.drainAppendedLines(managed)
          : undefined;
      },
      hasProcess: (id) => this.registry.has(id),
    });

    this.runtime = new ProcessRuntimeController({
      registry: this.registry,
      logs: this.logs,
      outputTracker: this.outputTracker,
      outputNotifier: this.outputNotifier,
      emit,
      getConfiguredShellPath:
        options?.getConfiguredShellPath ?? (() => undefined),
    });
  }

  // --- Event subscription ---

  onEvent(listener: (event: ManagerEvent) => void): () => void {
    this.events.on("event", listener);
    return () => this.events.off("event", listener);
  }

  // --- Process lifecycle ---

  start(
    name: string,
    command: string,
    cwd: string,
    options?: StartOptions,
  ): ProcessInfo {
    const managed = this.runtime.start(name, command, cwd, options);
    return {
      id: managed.id,
      name: managed.name,
      pid: managed.pid,
      command: managed.command,
      cwd: managed.cwd,
      startTime: managed.startTime,
      endTime: managed.endTime,
      status: managed.status,
      exitCode: managed.exitCode,
      success: managed.success,
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
      alertOnSuccess: managed.alertOnSuccess,
      alertOnFailure: managed.alertOnFailure,
      alertOnKill: managed.alertOnKill,
    };
  }

  list(): ProcessInfo[] {
    return this.registry.list();
  }

  get(id: string): ProcessInfo | null {
    return this.registry.getPublicInfo(id);
  }

  // --- Output retrieval ---

  getOutput(
    id: string,
    tailLines = 100,
  ): { stdout: string[]; stderr: string[]; status: string } | null {
    const managed = this.registry.getRecord(id);
    if (!managed) return null;

    return {
      stdout: this.logs.readTailLines(managed.stdoutFile, tailLines),
      stderr: this.logs.readTailLines(managed.stderrFile, tailLines),
      status: managed.status,
    };
  }

  getCombinedOutput(
    id: string,
    tailLines = 100,
  ): Array<{ type: "stdout" | "stderr"; text: string }> | null {
    const managed = this.registry.getRecord(id);
    if (!managed) return null;
    return this.logs.getCombinedOutput(managed.combinedFile, tailLines);
  }

  getFullOutput(id: string): { stdout: string; stderr: string } | null {
    const managed = this.registry.getRecord(id);
    if (!managed) return null;
    return {
      stdout: this.logs.readFullFile(managed.stdoutFile),
      stderr: this.logs.readFullFile(managed.stderrFile),
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
    return this.logs.getFileSize({
      stdoutFile: managed.stdoutFile,
      stderrFile: managed.stderrFile,
      combinedFile: managed.combinedFile,
    });
  }

  // --- Kill operations ---

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

  addLogWatches(id: string, watches: LogWatch[]): AddLogWatchesResult {
    return this.runtime.addLogWatches(id, watches);
  }

  killAll(): void {
    this.runtime.killAll();
  }

  // --- Cleanup ---

  clearFinished(): number {
    return this.runtime.clearFinished();
  }

  stopWatcher(): void {
    this.runtime.stopWatcher();
  }

  cleanup(): void {
    this.runtime.stopWatcher();
    this.outputNotifier.clearAll();
    this.runtime.killAllLive();
    this.logs.cleanup();
  }

  [Symbol.dispose](): void {
    this.cleanup();
  }
}

export type {
  AddLogWatchesResult,
  KillResult,
  LogWatch,
  ManagerEvent,
  ProcessInfo,
  ProcessStatus,
  WriteResult,
} from "../types";
