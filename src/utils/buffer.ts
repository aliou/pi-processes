/** Trim trailing bytes that form an incomplete UTF-8 code point. */
export function trimIncompleteUtf8Suffix(buffer: Buffer): Buffer {
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

/** Keep the last `maxBytes` of a buffer, trimming any incomplete UTF-8 sequence. */
export function clampToTail(buf: Buffer, maxBytes: number): Buffer {
  if (buf.length <= maxBytes) return buf;
  return trimIncompleteUtf8Suffix(buf.subarray(buf.length - maxBytes));
}
