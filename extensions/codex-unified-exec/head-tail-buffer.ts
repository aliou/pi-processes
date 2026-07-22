/**
 * A capped buffer that preserves a stable prefix ("head") and suffix ("tail"),
 * dropping the middle once it exceeds the configured maximum. Symmetric: 50%
 * of capacity to the head, 50% to the tail.
 *
 * Direct port of codex's HeadTailBuffer
 * (codex-rs/core/src/unified_exec/head_tail_buffer.rs). Codex stores the head
 * as a contiguous Vec<u8> and the tail as a VecDeque<u8>; this port stores both
 * as a Node Buffer (contiguous). The behavior — retained/omitted byte counts,
 * the omission marker placement, and drain/push_buffer semantics — is identical.
 */

import {
  formatOutputOmissionMarker,
  UNIFIED_EXEC_OUTPUT_MAX_BYTES,
} from "./constants";

export class HeadTailBuffer {
  readonly maxBytes: number;
  readonly headBudget: number;
  readonly tailBudget: number;
  private head: Buffer = Buffer.alloc(0);
  private tail: Buffer = Buffer.alloc(0);
  private omittedBytesInternal = 0;

  constructor(maxBytes: number) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) {
      throw new Error(
        `maxBytes must be a non-negative finite number (got ${maxBytes})`,
      );
    }
    this.maxBytes = Math.floor(maxBytes);
    this.headBudget = Math.floor(this.maxBytes / 2);
    this.tailBudget = Math.max(0, this.maxBytes - this.headBudget);
  }

  static get defaultMaxBytes(): number {
    return UNIFIED_EXEC_OUTPUT_MAX_BYTES;
  }

  /** Total bytes currently retained by the buffer (head + tail). */
  get retainedBytes(): number {
    return this.head.length + this.tail.length;
  }

  /** Total bytes dropped from the middle due to the size cap. */
  get omittedBytes(): number {
    return this.omittedBytesInternal;
  }

  /** Total bytes observed, including dropped bytes. (codex total_bytes) */
  totalBytes(): number {
    return this.retainedBytes + this.omittedBytesInternal;
  }

  /**
   * Append a chunk of bytes. Fills the head budget first; remaining bytes go to
   * the tail, dropping older tail bytes to preserve the tail budget.
   */
  pushChunk(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (this.maxBytes === 0) {
      this.omittedBytesInternal += chunk.length;
      return;
    }

    const remainingHead = this.headBudget - this.head.length;
    const headLen = Math.min(remainingHead, chunk.length);
    if (headLen > 0) {
      this.head = Buffer.concat([this.head, chunk.subarray(0, headLen)]);
    }
    this.pushToTail(chunk.subarray(headLen));
  }

  /** Snapshot retained chunks: head first (if any), then tail (if any). */
  snapshotChunks(): Buffer[] {
    const out: Buffer[] = [];
    if (this.head.length > 0) out.push(Buffer.from(this.head));
    if (this.tail.length > 0) out.push(Buffer.from(this.tail));
    return out;
  }

  /** Retained output as a single Buffer (head ++ tail). */
  toBytes(): Buffer {
    if (this.tail.length === 0) return Buffer.from(this.head);
    if (this.head.length === 0) return Buffer.from(this.tail);
    return Buffer.concat([this.head, this.tail]);
  }

  /**
   * Retained output with an explicit omission marker between head and tail when
   * bytes were dropped. Mirrors codex to_bytes_with_omission_marker:
   * head + "\n" + marker + "\n" + tail.
   */
  toBytesWithOmissionMarker(): Buffer {
    if (this.omittedBytesInternal === 0) return this.toBytes();
    const marker = formatOutputOmissionMarker(this.omittedBytesInternal);
    return Buffer.concat([
      this.head,
      Buffer.from("\n"),
      Buffer.from(marker, "utf8"),
      Buffer.from("\n"),
      this.tail,
    ]);
  }

  /**
   * Drain retained output and omission metadata into a new buffer, resetting
   * this buffer's contents while preserving its capacity. Mirrors codex drain.
   */
  drain(): HeadTailBuffer {
    const taken = new HeadTailBuffer(this.maxBytes);
    taken.head = this.head;
    taken.tail = this.tail;
    taken.omittedBytesInternal = this.omittedBytesInternal;
    this.head = Buffer.alloc(0);
    this.tail = Buffer.alloc(0);
    this.omittedBytesInternal = 0;
    return taken;
  }

  /**
   * Append retained output from another buffer and preserve any omissions it
   * recorded. Mirrors codex push_buffer.
   */
  pushBuffer(buffer: HeadTailBuffer): void {
    this.pushChunk(buffer.head);
    this.pushChunk(buffer.tail);
    this.omittedBytesInternal += buffer.omittedBytes;
  }

  private pushToTail(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (this.tailBudget === 0) {
      this.omittedBytesInternal += chunk.length;
      return;
    }

    if (chunk.length >= this.tailBudget) {
      // Single chunk larger than the whole tail budget: keep only the last
      // tailBudget bytes and drop everything else.
      const start = chunk.length - this.tailBudget;
      const kept = chunk.subarray(start);
      const dropped = chunk.length - kept.length;
      this.omittedBytesInternal += this.tail.length + dropped;
      this.tail = Buffer.from(kept);
      return;
    }

    this.tail = Buffer.concat([this.tail, chunk]);
    this.trimTailToBudget();
  }

  private trimTailToBudget(): void {
    const excess = this.tail.length - this.tailBudget;
    if (excess > 0) {
      this.tail = Buffer.from(this.tail.subarray(excess));
      this.omittedBytesInternal += excess;
    }
  }
}
