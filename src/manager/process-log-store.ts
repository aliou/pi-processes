import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProcessLogPaths } from "./internal-types";
import { MAX_TAIL_READ_BYTES } from "./limits";

const TAIL_CHUNK_BYTES = 64 * 1024;
const MAX_FULL_FILE_BYTES = MAX_TAIL_READ_BYTES * 8;
const TAIL_TRUNCATION_PREFIX = "[… truncated] ";

export class ProcessLogStore {
  private logDir: string;

  constructor(logDir?: string) {
    if (logDir) {
      this.logDir = logDir;
      mkdirSync(this.logDir, { recursive: true });
      return;
    }

    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    this.logDir = mkdtempSync(join(tempParent, "pi-processes-"));
  }

  getLogDir(): string {
    return this.logDir;
  }

  createLogs(processId: string): ProcessLogPaths {
    const stdoutFile = join(this.logDir, `${processId}-stdout.log`);
    const stderrFile = join(this.logDir, `${processId}-stderr.log`);
    const combinedFile = join(this.logDir, `${processId}-combined.log`);

    appendFileSync(stdoutFile, "");
    appendFileSync(stderrFile, "");
    appendFileSync(combinedFile, "");

    return { stdoutFile, stderrFile, combinedFile };
  }

  appendStdout(file: string, data: Buffer): void {
    try {
      appendFileSync(file, data);
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  appendStderr(file: string, data: Buffer): void {
    try {
      appendFileSync(file, data);
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  appendCombinedLine(
    file: string,
    source: "stdout" | "stderr",
    line: string,
  ): void {
    const tag = source === "stdout" ? "1" : "2";
    try {
      appendFileSync(file, `${tag}:${line}\n`);
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  appendErrorLine(file: string, message: string): void {
    try {
      appendFileSync(file, `${message}\n`);
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  readTailLines(filePath: string, lines: number): string[] {
    if (lines <= 0) return [];

    let fd: number | undefined;
    try {
      fd = openSync(filePath, "r");
      const size = fstatSync(fd).size;
      if (size === 0) return [];

      const buffer = Buffer.allocUnsafe(Math.min(size, MAX_TAIL_READ_BYTES));
      let bufferStart = buffer.length;
      let position = size;
      let bytesRead = 0;
      let newlineCount = 0;

      while (
        position > 0 &&
        bytesRead < MAX_TAIL_READ_BYTES &&
        newlineCount <= lines
      ) {
        const length = Math.min(
          TAIL_CHUNK_BYTES,
          position,
          MAX_TAIL_READ_BYTES - bytesRead,
        );
        position -= length;
        bufferStart -= length;
        readExact(fd, buffer, bufferStart, length, position);
        bytesRead += length;
        newlineCount += countNewlines(
          buffer.subarray(bufferStart, bufferStart + length),
        );
      }

      let populated: Buffer<ArrayBufferLike> = buffer.subarray(bufferStart);
      const startedMidFile = position > 0;
      let partialFirstLine: Buffer | undefined;
      if (startedMidFile) {
        const firstNewline = populated.indexOf(0x0a);
        if (firstNewline === -1) {
          populated = alignUtf8Start(populated);
          const suffix = decodeUtf8Bounded(populated, MAX_TAIL_READ_BYTES);
          return [`${TAIL_TRUNCATION_PREFIX}${suffix}`];
        }
        // The read began in the middle of a logical line. Dropping through
        // its newline also removes any partial UTF-8 code point at the start.
        const partial = alignUtf8Start(populated.subarray(0, firstNewline));
        if (partial.length > 0) {
          partialFirstLine = partial;
        }
        populated = populated.subarray(firstNewline + 1);
      }

      const rawLines = tailLineBuffersNewestFirst(populated, lines);
      if (partialFirstLine && rawLines.length < lines) {
        rawLines.push(partialFirstLine);
      }

      const decodedNewestFirst: string[] = [];
      let remainingBytes = MAX_TAIL_READ_BYTES;
      for (
        let index = 0;
        index < rawLines.length && remainingBytes > 0;
        index++
      ) {
        const rawLine = rawLines[index];
        const decoded = decodeUtf8Bounded(rawLine, remainingBytes);
        const marked =
          partialFirstLine && rawLine === partialFirstLine
            ? `${TAIL_TRUNCATION_PREFIX}${decoded}`
            : decoded;
        decodedNewestFirst.push(marked);
        remainingBytes -= Buffer.byteLength(decoded);
      }
      return decodedNewestFirst.reverse();
    } catch (_error) {
      return [];
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  readFullFile(filePath: string): string {
    try {
      const size = statSync(filePath).size;
      if (size > MAX_FULL_FILE_BYTES) {
        const marker = `[… truncated, see ${filePath}]\n`;
        const markerBytes = Buffer.byteLength(marker);
        const suffix = this.readFileSuffix(
          filePath,
          Math.max(0, MAX_FULL_FILE_BYTES - markerBytes),
        );
        return marker + suffix;
      }
      return readFileSync(filePath, "utf-8");
    } catch (_error) {
      return "";
    }
  }

  getCombinedOutput(
    combinedFile: string,
    tailLines: number,
  ): Array<{ type: "stdout" | "stderr"; text: string }> {
    const rawLines = this.readTailLines(combinedFile, tailLines);
    return rawLines.map((line) => {
      if (line.startsWith("2:")) {
        return { type: "stderr" as const, text: line.slice(2) };
      }
      return {
        type: "stdout" as const,
        text: line.startsWith("1:") ? line.slice(2) : line,
      };
    });
  }

  getFileSize(paths: ProcessLogPaths): { stdout: number; stderr: number } {
    try {
      return {
        stdout: statSync(paths.stdoutFile).size,
        stderr: statSync(paths.stderrFile).size,
      };
    } catch (_error) {
      return { stdout: 0, stderr: 0 };
    }
  }

  removeLogs(paths: ProcessLogPaths): void {
    try {
      rmSync(paths.stdoutFile, { force: true });
      rmSync(paths.stderrFile, { force: true });
      rmSync(paths.combinedFile, { force: true });
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  cleanup(): void {
    try {
      rmSync(this.logDir, { recursive: true, force: true });
    } catch (_error) {
      void _error; // Intentionally ignored
    }
  }

  [Symbol.dispose](): void {
    this.cleanup();
  }

  private readFileSuffix(filePath: string, maxBytes: number): string {
    let fd: number | undefined;
    try {
      fd = openSync(filePath, "r");
      const size = fstatSync(fd).size;
      const length = Math.min(size, maxBytes);
      const buffer = Buffer.allocUnsafe(length);
      readExact(fd, buffer, 0, length, size - length);
      return decodeUtf8Bounded(alignUtf8Start(buffer), maxBytes);
    } catch (_error) {
      return "";
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
}

function countNewlines(buffer: Buffer): number {
  let count = 0;
  for (const byte of buffer) {
    if (byte === 0x0a) count++;
  }
  return count;
}

function alignUtf8Start(buffer: Buffer): Buffer {
  let start = 0;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
  return buffer.subarray(start);
}

function readExact(
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
): void {
  let total = 0;
  while (total < length) {
    const count = readSync(
      fd,
      buffer,
      offset + total,
      length - total,
      position + total,
    );
    if (count === 0) throw new Error("Unexpected end of log file");
    total += count;
  }
}

function tailLineBuffersNewestFirst(buffer: Buffer, count: number): Buffer[] {
  if (buffer.length === 0 || count <= 0) return [];

  const result: Buffer[] = [];
  let end = buffer.length;
  if (buffer[end - 1] === 0x0a) end--;

  while (result.length < count && end >= 0) {
    const newline = end > 0 ? buffer.lastIndexOf(0x0a, end - 1) : -1;
    const start = newline + 1;
    let lineEnd = end;
    if (lineEnd > start && buffer[lineEnd - 1] === 0x0d) lineEnd--;
    result.push(buffer.subarray(start, lineEnd));
    if (newline === -1) break;
    end = newline;
  }

  return result;
}

function decodeUtf8Bounded(buffer: Buffer, maxOutputBytes: number): string {
  if (buffer.length === 0 || maxOutputBytes <= 0) return "";

  const decoder = new TextDecoder("utf-8");
  const parts: string[] = [];
  let remaining = maxOutputBytes;

  for (let offset = 0; offset < buffer.length && remaining > 0; ) {
    const end = Math.min(buffer.length, offset + TAIL_CHUNK_BYTES);
    const text = decoder.decode(buffer.subarray(offset, end), {
      stream: end < buffer.length,
    });
    const textBytes = Buffer.byteLength(text);
    if (textBytes <= remaining) {
      parts.push(text);
      remaining -= textBytes;
    } else {
      const prefix = trimIncompleteUtf8Suffix(
        Buffer.from(text).subarray(0, remaining),
      );
      parts.push(prefix.toString("utf-8"));
      remaining = 0;
    }
    offset = end;
  }

  return parts.join("");
}

function trimIncompleteUtf8Suffix(buffer: Buffer): Buffer {
  if (buffer.length === 0) return buffer;
  let lead = buffer.length - 1;
  while (lead >= 0 && (buffer[lead] & 0xc0) === 0x80) lead--;
  if (lead < 0) return Buffer.alloc(0);
  const byte = buffer[lead];
  const expected =
    byte < 0x80
      ? 1
      : (byte & 0xe0) === 0xc0
        ? 2
        : (byte & 0xf0) === 0xe0
          ? 3
          : (byte & 0xf8) === 0xf0
            ? 4
            : 1;
  return buffer.length - lead < expected ? buffer.subarray(0, lead) : buffer;
}
