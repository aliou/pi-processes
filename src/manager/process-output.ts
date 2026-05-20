import type { ManagerEvent } from "../types";
import type { ManagedProcessRecord } from "./internal-types";
import type { ProcessLogStore } from "./process-log-store";

interface ProcessOutputDeps {
  emit: (event: ManagerEvent) => void;
  logStore: ProcessLogStore;
  throttleMs?: number;
}

export class ProcessOutput {
  private emit: (event: ManagerEvent) => void;
  private logStore: ProcessLogStore;
  private throttleMs: number;

  private lastOutputEmitAt: Map<string, number> = new Map();
  private pendingOutputEmit: Map<string, NodeJS.Timeout> = new Map();

  constructor(deps: ProcessOutputDeps) {
    this.emit = deps.emit;
    this.logStore = deps.logStore;
    this.throttleMs = deps.throttleMs ?? 100;
  }

  onStdoutChunk(record: ManagedProcessRecord, data: Buffer): string[] {
    const lines = this.extractCompleteLines(record, "stdout", data);
    for (const line of lines) {
      this.logStore.appendCombinedLine(record.combinedFile, "stdout", line);
      record.appendedLines.push({ type: "stdout", text: line });
    }
    this.notify(record);
    return lines;
  }

  onStderrChunk(record: ManagedProcessRecord, data: Buffer): string[] {
    const lines = this.extractCompleteLines(record, "stderr", data);
    for (const line of lines) {
      this.logStore.appendCombinedLine(record.combinedFile, "stderr", line);
      record.appendedLines.push({ type: "stderr", text: line });
    }
    this.notify(record);
    return lines;
  }

  flush(record: ManagedProcessRecord): void {
    this.flushPendingLines(record);

    const timeout = this.pendingOutputEmit.get(record.id);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingOutputEmit.delete(record.id);
    }

    const appendedText = this.drainAppendedLines(record);
    if (!timeout && !appendedText) return;

    this.lastOutputEmitAt.set(record.id, Date.now());
    this.emit({
      type: "process_output_changed",
      id: record.id,
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

  private notify(record: ManagedProcessRecord): void {
    const now = Date.now();
    const lastEmit = this.lastOutputEmitAt.get(record.id) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= this.throttleMs) {
      this.lastOutputEmitAt.set(record.id, now);
      const appendedText = this.drainAppendedLines(record);
      this.emit({
        type: "process_output_changed",
        id: record.id,
        ...(appendedText ? { appendedText } : {}),
      });
      return;
    }

    if (!this.pendingOutputEmit.has(record.id)) {
      const delay = this.throttleMs - elapsed;
      const timeout = setTimeout(() => {
        this.pendingOutputEmit.delete(record.id);
        const appendedText = this.drainAppendedLines(record);
        if (!appendedText) return;
        this.lastOutputEmitAt.set(record.id, Date.now());
        this.emit({
          type: "process_output_changed",
          id: record.id,
          appendedText,
        });
      }, delay);
      this.pendingOutputEmit.set(record.id, timeout);
    }
  }

  private flushPendingLines(record: ManagedProcessRecord): void {
    if (record.stdoutPendingLine) {
      this.logStore.appendCombinedLine(
        record.combinedFile,
        "stdout",
        record.stdoutPendingLine,
      );
      record.appendedLines.push({
        type: "stdout",
        text: record.stdoutPendingLine,
      });
      record.stdoutPendingLine = "";
    }

    if (record.stderrPendingLine) {
      this.logStore.appendCombinedLine(
        record.combinedFile,
        "stderr",
        record.stderrPendingLine,
      );
      record.appendedLines.push({
        type: "stderr",
        text: record.stderrPendingLine,
      });
      record.stderrPendingLine = "";
    }
  }

  private drainAppendedLines(
    record: ManagedProcessRecord,
  ): Array<{ type: "stdout" | "stderr"; text: string }> | undefined {
    if (record.appendedLines.length === 0) return undefined;
    const lines = record.appendedLines;
    record.appendedLines = [];
    return lines;
  }

  private extractCompleteLines(
    record: ManagedProcessRecord,
    source: "stdout" | "stderr",
    data: Buffer,
  ): string[] {
    const chunk = data.toString();
    const pending =
      source === "stdout" ? record.stdoutPendingLine : record.stderrPendingLine;
    const merged = pending + chunk;
    const parts = merged.split(/\r?\n/);
    const completeLines = parts.slice(0, -1);
    const nextPending = parts[parts.length - 1] ?? "";

    if (source === "stdout") {
      record.stdoutPendingLine = nextPending;
    } else {
      record.stderrPendingLine = nextPending;
    }

    return completeLines;
  }

  [Symbol.dispose](): void {
    this.clearAll();
  }
}
