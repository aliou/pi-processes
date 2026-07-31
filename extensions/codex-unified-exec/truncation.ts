/**
 * Output truncation utilities, direct port of codex:
 *   codex-rs/utils/output-truncation/src/lib.rs (formatted_truncate_text,
 *     truncate_text)
 *   codex-rs/utils/string/src/truncate.rs (approx_token_count,
 *     approx_bytes_for_tokens, truncate_middle_*,
 *     truncate_with_byte_estimate, split_string, format_truncation_marker)
 *
 * Middle truncation preserves a prefix and suffix on UTF-8 boundaries and
 * inserts a marker ("…N tokens truncated…" / "…N chars truncated…") between
 * them. All byte arithmetic is done on UTF-8 bytes, matching codex's len()-based
 * comparisons even though JS strings are UTF-16.
 */

export type TruncationPolicy =
  | { type: "bytes"; bytes: number }
  | { type: "tokens"; tokens: number };

export function byteBudget(policy: TruncationPolicy): number {
  return policy.type === "bytes"
    ? policy.bytes
    : approxBytesForTokens(policy.tokens);
}

export function tokenBudget(policy: TruncationPolicy): number {
  return policy.type === "tokens"
    ? policy.tokens
    : approxTokensFromByteCount(policy.bytes);
}

const APPROX_BYTES_PER_TOKEN = 4;

export function approxTokenCount(text: string): number {
  return approxTokensFromByteCount(Buffer.byteLength(text, "utf8"));
}

export function approxBytesForTokens(tokens: number): number {
  return tokens * APPROX_BYTES_PER_TOKEN;
}

export function approxTokensFromByteCount(bytes: number): number {
  if (bytes <= 0) return 0;
  return Math.ceil(bytes / APPROX_BYTES_PER_TOKEN);
}

export function truncateText(
  content: string,
  policy: TruncationPolicy,
): string {
  return policy.type === "bytes"
    ? truncateMiddleChars(content, policy.bytes)
    : truncateMiddleWithTokenBudget(content, policy.tokens).truncated;
}

export function formattedTruncateText(
  content: string,
  policy: TruncationPolicy,
): string {
  if (Buffer.byteLength(content, "utf8") <= byteBudget(policy)) {
    return content;
  }
  const originalTokenCount = approxTokenCount(content);
  const totalLines = countLines(content);
  const result = truncateText(content, policy);
  return `Warning: truncated output (original token count: ${originalTokenCount})\nTotal output lines: ${totalLines}\n\n${result}`;
}

export function truncateMiddleChars(s: string, maxBytes: number): string {
  return truncateWithByteEstimate(s, maxBytes, false);
}

export interface TokenBudgetResult {
  truncated: string;
  originalTokenCount: number | null;
}

export function truncateMiddleWithTokenBudget(
  s: string,
  maxTokens: number,
): TokenBudgetResult {
  if (s.length === 0) {
    return { truncated: "", originalTokenCount: null };
  }
  const byteLen = Buffer.byteLength(s, "utf8");
  const budget = approxBytesForTokens(maxTokens);
  if (maxTokens > 0 && byteLen <= budget) {
    return { truncated: s, originalTokenCount: null };
  }
  const truncated = truncateWithByteEstimate(s, budget, true);
  if (truncated === s) {
    return { truncated, originalTokenCount: null };
  }
  return { truncated, originalTokenCount: approxTokenCount(s) };
}

function truncateWithByteEstimate(
  s: string,
  maxBytes: number,
  useTokens: boolean,
): string {
  if (s.length === 0) return "";
  const bytes = Buffer.from(s, "utf8");
  const totalBytes = bytes.length;

  if (maxBytes === 0) {
    const totalChars = countCodePoints(bytes);
    return formatTruncationMarker(
      useTokens,
      removedUnits(useTokens, totalBytes, totalChars),
    );
  }

  if (totalBytes <= maxBytes) return s;

  const [leftBudget, rightBudget] = splitBudget(maxBytes);
  const [removedChars, before, after] = splitStringBytes(
    bytes,
    leftBudget,
    rightBudget,
  );
  const marker = formatTruncationMarker(
    useTokens,
    removedUnits(useTokens, totalBytes - maxBytes, removedChars),
  );
  return assembleTruncatedOutput(before, after, marker);
}

function splitBudget(budget: number): [number, number] {
  const left = Math.floor(budget / 2);
  return [left, budget - left];
}

function splitStringBytes(
  bytes: Buffer,
  beginningBytes: number,
  endBytes: number,
): [number, string, string] {
  const len = bytes.length;
  if (len === 0) return [0, "", ""];
  const tailStartTarget = Math.max(0, len - endBytes);
  let prefixEnd = 0;
  let suffixStart = len;
  let removedChars = 0;
  let suffixStarted = false;
  let i = 0;
  while (i < len) {
    const charLen = utf8CharLen(bytes[i]);
    const charEnd = Math.min(i + charLen, len);
    if (charEnd <= beginningBytes) {
      prefixEnd = charEnd;
    } else if (i >= tailStartTarget) {
      if (!suffixStarted) {
        suffixStart = i;
        suffixStarted = true;
      }
    } else {
      removedChars += 1;
    }
    i = charEnd;
  }
  if (suffixStart < prefixEnd) suffixStart = prefixEnd;
  const before = bytes.subarray(0, prefixEnd).toString("utf8");
  const after = bytes.subarray(suffixStart).toString("utf8");
  return [removedChars, before, after];
}

function utf8CharLen(leadByte: number): number {
  const b = leadByte & 0xff;
  if (b < 0x80) return 1;
  if ((b & 0xe0) === 0xc0) return 2;
  if ((b & 0xf0) === 0xe0) return 3;
  if ((b & 0xf8) === 0xf0) return 4;
  return 1;
}

function countCodePoints(bytes: Buffer): number {
  let n = 0;
  let i = 0;
  while (i < bytes.length) {
    i += utf8CharLen(bytes[i]);
    n += 1;
  }
  return n;
}

function formatTruncationMarker(
  useTokens: boolean,
  removedCount: number,
): string {
  return useTokens
    ? `…${removedCount} tokens truncated…`
    : `…${removedCount} chars truncated…`;
}

function removedUnits(
  useTokens: boolean,
  removedBytes: number,
  removedChars: number,
): number {
  return useTokens ? approxTokensFromByteCount(removedBytes) : removedChars;
}

function assembleTruncatedOutput(
  prefix: string,
  suffix: string,
  marker: string,
): string {
  return `${prefix}${marker}${suffix}`;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  const normalized = content.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  let count = parts.length;
  if (parts[count - 1] === "") count -= 1;
  return count;
}
