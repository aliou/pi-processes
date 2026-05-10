import type { ManagerEvent } from "../types";

interface OutputChangeNotifierDeps {
  emit: (event: ManagerEvent) => void;
  getAppendedLines: (
    processId: string,
  ) => Array<{ type: "stdout" | "stderr"; text: string }> | undefined;
  hasProcess: (processId: string) => boolean;
  throttleMs?: number;
}

export class OutputChangeNotifier {
  private emit: (event: ManagerEvent) => void;
  private getAppendedLines: (
    processId: string,
  ) => Array<{ type: "stdout" | "stderr"; text: string }> | undefined;
  private hasProcess: (processId: string) => boolean;
  private throttleMs: number;

  private lastOutputEmitAt: Map<string, number> = new Map();
  private pendingOutputEmit: Map<string, NodeJS.Timeout> = new Map();

  constructor(deps: OutputChangeNotifierDeps) {
    this.emit = deps.emit;
    this.getAppendedLines = deps.getAppendedLines;
    this.hasProcess = deps.hasProcess;
    this.throttleMs = deps.throttleMs ?? 100;
  }

  notify(id: string): void {
    const now = Date.now();
    const lastEmit = this.lastOutputEmitAt.get(id) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= this.throttleMs) {
      this.lastOutputEmitAt.set(id, now);
      const appendedText = this.getAppendedLines(id);
      this.emit({
        type: "process_output_changed",
        id,
        ...(appendedText ? { appendedText } : {}),
      });
      return;
    }

    if (!this.pendingOutputEmit.has(id)) {
      const delay = this.throttleMs - elapsed;
      const timeout = setTimeout(() => {
        this.pendingOutputEmit.delete(id);
        if (!this.hasProcess(id)) return;
        this.lastOutputEmitAt.set(id, Date.now());
        const appendedText = this.getAppendedLines(id);
        this.emit({
          type: "process_output_changed",
          id,
          ...(appendedText ? { appendedText } : {}),
        });
      }, delay);
      this.pendingOutputEmit.set(id, timeout);
    }
  }

  flush(id: string): void {
    const timeout = this.pendingOutputEmit.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingOutputEmit.delete(id);
    }

    const appendedText = this.getAppendedLines(id);
    if (!timeout && !appendedText) return;

    this.lastOutputEmitAt.set(id, Date.now());
    this.emit({
      type: "process_output_changed",
      id,
      ...(appendedText ? { appendedText } : {}),
    });
  }

  clear(id: string): void {
    const timeout = this.pendingOutputEmit.get(id);
    if (timeout) clearTimeout(timeout);
    this.pendingOutputEmit.delete(id);
    this.lastOutputEmitAt.delete(id);
  }

  clearAll(): void {
    for (const timeout of this.pendingOutputEmit.values()) {
      clearTimeout(timeout);
    }
    this.pendingOutputEmit.clear();
    this.lastOutputEmitAt.clear();
  }

  [Symbol.dispose](): void {
    this.clearAll();
  }
}
