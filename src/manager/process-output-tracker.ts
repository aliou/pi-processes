import type { ManagedProcessRecord } from "./internal-types";

interface ProcessOutputTrackerDeps {
  appendCombinedLine: (
    combinedFile: string,
    source: "stdout" | "stderr",
    line: string,
  ) => void;
}

export class ProcessOutputTracker {
  private appendCombinedLine: (
    combinedFile: string,
    source: "stdout" | "stderr",
    line: string,
  ) => void;

  constructor(deps: ProcessOutputTrackerDeps) {
    this.appendCombinedLine = deps.appendCombinedLine;
  }

  onStdoutChunk(record: ManagedProcessRecord, data: Buffer): string[] {
    const lines = this.extractCompleteLines(record, "stdout", data);
    for (const line of lines) {
      this.appendCombinedLine(record.combinedFile, "stdout", line);
      record.appendedLines.push({ type: "stdout", text: line });
    }
    return lines;
  }

  onStderrChunk(record: ManagedProcessRecord, data: Buffer): string[] {
    const lines = this.extractCompleteLines(record, "stderr", data);
    for (const line of lines) {
      this.appendCombinedLine(record.combinedFile, "stderr", line);
      record.appendedLines.push({ type: "stderr", text: line });
    }
    return lines;
  }

  flushPendingLines(record: ManagedProcessRecord): void {
    if (record.stdoutPendingLine) {
      this.appendCombinedLine(
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
      this.appendCombinedLine(
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

  drainAppendedLines(
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
    // No state to clean up.
  }
}
