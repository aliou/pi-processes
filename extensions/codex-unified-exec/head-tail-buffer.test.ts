import { describe, expect, it } from "vitest";

import { formatOutputOmissionMarker } from "./constants";
import { HeadTailBuffer } from "./head-tail-buffer";

const b = (s: string) => Buffer.from(s, "utf8");

describe("HeadTailBuffer", () => {
  it("fills the head first, then the tail, with no omission under cap", () => {
    const buf = new HeadTailBuffer(8);
    buf.pushChunk(b("abc"));
    expect(buf.retainedBytes).toBe(3);
    expect(buf.omittedBytes).toBe(0);
    expect(buf.totalBytes()).toBe(3);
    expect(buf.toBytes().toString("utf8")).toBe("abc");

    buf.pushChunk(b("defgh"));
    expect(buf.retainedBytes).toBe(8); // head 4 + tail 4
    expect(buf.omittedBytes).toBe(0);
    expect(buf.toBytes().toString("utf8")).toBe("abcdefgh");
  });

  it("drops the middle once over cap and reports omitted bytes", () => {
    const buf = new HeadTailBuffer(8);
    buf.pushChunk(b("abcdefgh")); // exactly 8: head abcd + tail efgh
    expect(buf.omittedBytes).toBe(0);

    buf.pushChunk(b("i")); // 9th byte evicts the oldest tail byte (e)
    expect(buf.retainedBytes).toBe(8);
    expect(buf.omittedBytes).toBe(1);
    expect(buf.totalBytes()).toBe(9);
    expect(buf.toBytes().toString("utf8")).toBe("abcdfghi");
  });

  it("toBytesWithOmissionMarker inserts the marker between head and tail", () => {
    const buf = new HeadTailBuffer(8);
    buf.pushChunk(b("abcdefghi")); // head abcd, tail fghi, 1 byte omitted
    expect(buf.omittedBytes).toBe(1);
    expect(buf.toBytes().toString("utf8")).toBe("abcdfghi");
    const withMarker = buf.toBytesWithOmissionMarker().toString("utf8");
    expect(withMarker).toBe(`abcd\n${formatOutputOmissionMarker(1)}\nfghi`);
  });

  it("returns plain toBytes via toBytesWithOmissionMarker when nothing was dropped", () => {
    const buf = new HeadTailBuffer(8);
    buf.pushChunk(b("abcd"));
    expect(buf.toBytesWithOmissionMarker().toString("utf8")).toBe("abcd");
  });

  it("keeps only the last tailBudget bytes when a single chunk exceeds the tail budget", () => {
    const buf = new HeadTailBuffer(4); // head 2, tail 2
    buf.pushChunk(b("012345")); // 6 bytes: head "01", tail keeps last 2 "45", drops "23" (2 bytes)
    expect(buf.toBytes().toString("utf8")).toBe("0145");
    expect(buf.omittedBytes).toBe(2);
    expect(buf.totalBytes()).toBe(6);
  });

  it("drains into a new buffer, leaving the source empty but cap intact", () => {
    const buf = new HeadTailBuffer(8);
    buf.pushChunk(b("abcdefghi"));
    expect(buf.omittedBytes).toBe(1);

    const drained = buf.drain();
    expect(drained.retainedBytes).toBe(8);
    expect(drained.omittedBytes).toBe(1);
    expect(drained.toBytes().toString("utf8")).toBe("abcdfghi");

    expect(buf.retainedBytes).toBe(0);
    expect(buf.omittedBytes).toBe(0);
    // Source buffer is usable again with the same capacity.
    buf.pushChunk(b("xy"));
    expect(buf.toBytes().toString("utf8")).toBe("xy");
  });

  it("pushBuffer merges retained bytes and omitted counts", () => {
    const a = new HeadTailBuffer(8);
    a.pushChunk(b("abcd"));
    const c = new HeadTailBuffer(8);
    c.pushChunk(b("abcdefghi")); // 1 byte omitted
    expect(c.omittedBytes).toBe(1);

    a.pushBuffer(c);
    // push_buffer re-applies the cap via push_chunk, so a re-omits the merged
    // tail overflow (4 bytes) in addition to c's recorded omission (1 byte).
    expect(a.toBytes().toString("utf8")).toBe("abcdfghi");
    expect(a.omittedBytes).toBe(5);
    expect(a.totalBytes()).toBe(13);
  });

  it("counts all observed bytes via totalBytes (retained + omitted)", () => {
    const buf = new HeadTailBuffer(4);
    buf.pushChunk(b("0123456789")); // 10 bytes, only 4 retained
    expect(buf.retainedBytes).toBe(4);
    expect(buf.omittedBytes).toBe(6);
    expect(buf.totalBytes()).toBe(10);
  });

  it("is a no-op for empty chunks", () => {
    const buf = new HeadTailBuffer(8);
    buf.pushChunk(Buffer.alloc(0));
    expect(buf.retainedBytes).toBe(0);
    expect(buf.totalBytes()).toBe(0);
  });
});
