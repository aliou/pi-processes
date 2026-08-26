import { describe, expect, it } from "vitest";
import { clampToTail, trimIncompleteUtf8Suffix } from "./buffer";

describe("trimIncompleteUtf8Suffix", () => {
  it("returns empty buffer unchanged", () => {
    expect(trimIncompleteUtf8Suffix(Buffer.alloc(0))).toEqual(Buffer.alloc(0));
  });

  it("returns ASCII buffer unchanged", () => {
    const buf = Buffer.from("hello", "utf8");
    expect(trimIncompleteUtf8Suffix(buf)).toEqual(buf);
  });

  it("returns complete multibyte buffer unchanged", () => {
    const buf = Buffer.from("héllo", "utf8"); // é is 2 bytes
    expect(trimIncompleteUtf8Suffix(buf)).toEqual(buf);
  });

  it("trims trailing incomplete 2-byte sequence", () => {
    const full = Buffer.from("é", "utf8"); // 0xc3 0xa9
    const truncated = full.subarray(0, 1); // just 0xc3
    expect(trimIncompleteUtf8Suffix(truncated)).toEqual(Buffer.alloc(0));
  });

  it("trims trailing incomplete 3-byte sequence", () => {
    const full = Buffer.from("€", "utf8"); // 0xe2 0x82 0xac
    const truncated = full.subarray(0, 2); // 0xe2 0x82
    expect(trimIncompleteUtf8Suffix(truncated)).toEqual(Buffer.alloc(0));
  });

  it("trims trailing incomplete 4-byte sequence", () => {
    // U+1F600 (4 bytes): 0xf0 0x9f 0x98 0x80
    const full = Buffer.from([0xf0, 0x9f, 0x98, 0x80]);
    const truncated = full.subarray(0, 3);
    expect(trimIncompleteUtf8Suffix(truncated)).toEqual(Buffer.alloc(0));
  });

  it("keeps valid text before the incomplete sequence", () => {
    const full = Buffer.from("abé", "utf8"); // a b 0xc3 0xa9
    const truncated = full.subarray(0, 3); // a b 0xc3
    expect(trimIncompleteUtf8Suffix(truncated)).toEqual(Buffer.from("ab"));
  });

  it("handles buffer that is all continuation bytes", () => {
    const buf = Buffer.from([0x80, 0x80, 0x80]);
    expect(trimIncompleteUtf8Suffix(buf)).toEqual(Buffer.alloc(0));
  });
});

describe("clampToTail", () => {
  it("returns buffer unchanged when within limit", () => {
    const buf = Buffer.from("hello", "utf8");
    expect(clampToTail(buf, 100)).toEqual(buf);
  });

  it("returns buffer unchanged when exactly at limit", () => {
    const buf = Buffer.alloc(64, 0x41);
    expect(clampToTail(buf, 64)).toEqual(buf);
  });

  it("keeps the tail when exceeding limit", () => {
    const buf = Buffer.from("AAAAAAAAAATAIL", "utf8");
    const result = clampToTail(buf, 4);
    expect(result.toString("utf8")).toBe("TAIL");
  });

  it("trims incomplete UTF-8 at the end of the tail", () => {
    const euro = Buffer.from("€", "utf8"); // 0xe2 0x82 0xac
    // Buffer that ends with an incomplete euro (first 2 of 3 bytes)
    const buf = Buffer.concat([Buffer.alloc(100, 0x41), euro.subarray(0, 2)]);
    const result = clampToTail(buf, 50); // tail = 48 A's + incomplete euro
    expect(result.toString("utf8")).toBe("A".repeat(48));
  });
});
