import type { ManagerEvent } from "../types";
import type { ManagedProcessRecord } from "./internal-types";
import {
  MAX_LINE_BYTES,
  MAX_LINES_PER_EMIT,
  MAX_PENDING_LINE_BYTES,
  TRUNCATION_SUFFIX,
} from "./limits";
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
    return this.extractCompleteLines(record, "stdout", data, (line) => {
      this.logStore.appendCombinedLine(record.combinedFile, "stdout", line);
      this.appendEventLine(record, "stdout", line);
    });
  }

  onStderrChunk(record: ManagedProcessRecord, data: Buffer): string[] {
    return this.extractCompleteLines(record, "stderr", data, (line) => {
      this.logStore.appendCombinedLine(record.combinedFile, "stderr", line);
      this.appendEventLine(record, "stderr", line);
    });
  }

  flush(record: ManagedProcessRecord): void {
    this.flushPendingLines(record);
    this.trimEventBuffer(record);

    const timeout = this.pendingOutputEmit.get(record.id);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingOutputEmit.delete(record.id);
    }

    const drained = this.drainAppendedLines(record);
    if (!timeout && !drained) return;

    this.lastOutputEmitAt.set(record.id, Date.now());
    this.emit({
      type: "process_output_changed",
      id: record.id,
      ...(drained?.appendedText ? { appendedText: drained.appendedText } : {}),
      ...(drained?.droppedLines ? { droppedLines: drained.droppedLines } : {}),
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
    this.trimEventBuffer(record);
    const now = Date.now();
    const lastEmit = this.lastOutputEmitAt.get(record.id) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= this.throttleMs) {
      this.lastOutputEmitAt.set(record.id, now);
      const drained = this.drainAppendedLines(record);
      this.emit({
        type: "process_output_changed",
        id: record.id,
        ...(drained?.appendedText
          ? { appendedText: drained.appendedText }
          : {}),
        ...(drained?.droppedLines
          ? { droppedLines: drained.droppedLines }
          : {}),
      });
      return;
    }

    if (!this.pendingOutputEmit.has(record.id)) {
      const delay = this.throttleMs - elapsed;
      const timeout = setTimeout(() => {
        this.pendingOutputEmit.delete(record.id);
        const drained = this.drainAppendedLines(record);
        if (!drained) return;
        this.lastOutputEmitAt.set(record.id, Date.now());
        this.emit({
          type: "process_output_changed",
          id: record.id,
          ...(drained.appendedText
            ? { appendedText: drained.appendedText }
            : {}),
          ...(drained.droppedLines
            ? { droppedLines: drained.droppedLines }
            : {}),
        });
      }, delay);
      this.pendingOutputEmit.set(record.id, timeout);
    }
  }

  private flushPendingLines(record: ManagedProcessRecord): void {
    if (record.stdoutPendingLine.length > 0) {
      const line = record.stdoutPendingLine.toString("utf-8");
      this.logStore.appendCombinedLine(record.combinedFile, "stdout", line);
      this.appendEventLine(record, "stdout", line);
    }
    record.stdoutPendingLine = Buffer.alloc(0);
    record.stdoutLineOverflowed = false;

    if (record.stderrPendingLine.length > 0) {
      const line = record.stderrPendingLine.toString("utf-8");
      this.logStore.appendCombinedLine(record.combinedFile, "stderr", line);
      this.appendEventLine(record, "stderr", line);
    }
    record.stderrPendingLine = Buffer.alloc(0);
    record.stderrLineOverflowed = false;
  }

  private drainAppendedLines(record: ManagedProcessRecord):
    | {
        appendedText?: Array<{
          type: "stdout" | "stderr";
          text: string;
        }>;
        droppedLines?: number;
      }
    | undefined {
    if (record.appendedLines.length === 0 && record.droppedLineCount === 0) {
      return undefined;
    }
    const lines = record.appendedLines;
    const droppedLines = record.droppedLineCount;
    record.appendedLines = [];
    record.droppedLineCount = 0;
    return {
      ...(lines.length > 0 ? { appendedText: lines } : {}),
      ...(droppedLines > 0 ? { droppedLines } : {}),
    };
  }

  private extractCompleteLines(
    record: ManagedProcessRecord,
    source: "stdout" | "stderr",
    data: Buffer,
    onLine: (line: string) => void,
  ): string[] {
    let pending = this.getPending(record, source);
    let overflowed = this.getOverflowed(record, source);
    const completeLines: string[] = [];
    let cursor = 0;

    if (overflowed) {
      const newline = data.indexOf(0x0a);
      if (newline === -1) {
        this.notify(record);
        return [];
      }
      cursor = newline + 1;
      overflowed = false;
      pending = Buffer.alloc(0);
    }

    let newline = data.indexOf(0x0a, cursor);
    while (newline !== -1) {
      const line = this.buildBoundedLine(
        pending,
        data.subarray(cursor, newline),
        true,
      );
      onLine(line);
      if (completeLines.length < MAX_LINES_PER_EMIT) completeLines.push(line);
      pending = Buffer.alloc(0);
      cursor = newline + 1;
      newline = data.indexOf(0x0a, cursor);
    }

    const tail = data.subarray(cursor);
    const tailLength = tail.length;
    if (pending.length + tailLength > MAX_PENDING_LINE_BYTES) {
      const line = this.buildBoundedLine(pending, tail, false);
      onLine(line);
      if (completeLines.length < MAX_LINES_PER_EMIT) completeLines.push(line);
      pending = Buffer.alloc(0);
      overflowed = true;
      // The raw stdout/stderr log still has the complete bytes. Dropping the
      // event-stream tail avoids turning one huge logical line into thousands
      // of synthetic lines in UI buffers.
    } else {
      pending =
        pending.length === 0
          ? Buffer.from(tail)
          : Buffer.concat([pending, tail], pending.length + tail.length);
    }

    this.setPending(record, source, pending);
    this.setOverflowed(record, source, overflowed);
    this.notify(record);
    return completeLines;
  }

  private buildBoundedLine(
    pending: Buffer,
    segment: Buffer,
    stripCarriageReturn: boolean,
  ): string {
    let pendingEnd = pending.length;
    let segmentEnd = segment.length;
    if (stripCarriageReturn) {
      if (segmentEnd > 0 && segment[segmentEnd - 1] === 0x0d) segmentEnd--;
      else if (
        segmentEnd === 0 &&
        pendingEnd > 0 &&
        pending[pendingEnd - 1] === 0x0d
      ) {
        pendingEnd--;
      }
    }

    const totalLength = pendingEnd + segmentEnd;
    if (totalLength <= MAX_PENDING_LINE_BYTES) {
      return Buffer.concat(
        [pending.subarray(0, pendingEnd), segment.subarray(0, segmentEnd)],
        totalLength,
      ).toString("utf-8");
    }

    const prefix = Buffer.allocUnsafe(MAX_PENDING_LINE_BYTES);
    const pendingLength = Math.min(pendingEnd, MAX_PENDING_LINE_BYTES);
    pending.copy(prefix, 0, 0, pendingLength);
    const segmentLength = MAX_PENDING_LINE_BYTES - pendingLength;
    segment.copy(prefix, pendingLength, 0, segmentLength);
    return `${trimIncompleteUtf8Suffix(prefix).toString("utf-8")}${TRUNCATION_SUFFIX}`;
  }

  private appendEventLine(
    record: ManagedProcessRecord,
    type: "stdout" | "stderr",
    text: string,
  ): void {
    record.appendedLines.push({ type, text: this.clampLine(text) });
    if (record.appendedLines.length <= MAX_LINES_PER_EMIT * 2) return;
    this.trimEventBuffer(record);
  }

  private trimEventBuffer(record: ManagedProcessRecord): void {
    if (record.appendedLines.length <= MAX_LINES_PER_EMIT) return;
    const overflow = record.appendedLines.length - MAX_LINES_PER_EMIT;
    record.appendedLines.splice(0, overflow);
    record.droppedLineCount += overflow;
  }

  private clampLine(text: string): string {
    if (Buffer.byteLength(text) <= MAX_LINE_BYTES) return text;
    const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX);
    const prefix = Buffer.from(text).subarray(0, MAX_LINE_BYTES - suffixBytes);
    return `${trimIncompleteUtf8Suffix(prefix).toString("utf-8")}${TRUNCATION_SUFFIX}`;
  }

  private getPending(
    record: ManagedProcessRecord,
    source: "stdout" | "stderr",
  ): Buffer {
    return source === "stdout"
      ? record.stdoutPendingLine
      : record.stderrPendingLine;
  }

  private setPending(
    record: ManagedProcessRecord,
    source: "stdout" | "stderr",
    value: Buffer,
  ): void {
    if (source === "stdout") record.stdoutPendingLine = value;
    else record.stderrPendingLine = value;
  }

  private getOverflowed(
    record: ManagedProcessRecord,
    source: "stdout" | "stderr",
  ): boolean {
    return source === "stdout"
      ? record.stdoutLineOverflowed
      : record.stderrLineOverflowed;
  }

  private setOverflowed(
    record: ManagedProcessRecord,
    source: "stdout" | "stderr",
    value: boolean,
  ): void {
    if (source === "stdout") record.stdoutLineOverflowed = value;
    else record.stderrLineOverflowed = value;
  }

  [Symbol.dispose](): void {
    this.clearAll();
  }
}

function trimIncompleteUtf8Suffix(buffer: Buffer): Buffer {
  if (buffer.length === 0) return buffer;

  let lead = buffer.length - 1;
  while (lead >= 0 && (buffer[lead] & 0xc0) === 0x80) lead--;
  if (lead < 0) return Buffer.alloc(0);

  const leadByte = buffer[lead];
  const expectedLength =
    leadByte < 0x80
      ? 1
      : (leadByte & 0xe0) === 0xc0
        ? 2
        : (leadByte & 0xf0) === 0xe0
          ? 3
          : (leadByte & 0xf8) === 0xf0
            ? 4
            : 1;
  const actualLength = buffer.length - lead;
  return actualLength < expectedLength ? buffer.subarray(0, lead) : buffer;
}
