/**
 * Local tail-truncation for the `process output` action.
 *
 * The installed Pi version (0.75.x) does not export its shared truncation
 * helper, so this module keeps a local implementation that mirrors the v0.10
 * behavior the agent depends on.
 *
 * Invariants:
 * - Always keeps the newest output within the byte and line budgets.
 * - A single oversized line yields a UTF-8-safe suffix instead of being
 *   dropped entirely.
 * - ANSI and terminal control characters must be stripped by callers before
 *   truncation; this module operates on already-cleaned text.
 *
 * The `truncation` metadata returned alongside the content matches the shape
 * Pi 0.10 exposes through `TruncationResult`, minus the `content` field, so it
 * can be persisted in `details` without re-embedding raw output.
 */

export const MAX_OUTPUT_BYTES = 50 * 1024;

/**
 * Ceiling applied to the JSON-escaped serialized content. Newline-heavy or
 * tab-heavy output inflates under `JSON.stringify`, so the composed result is
 * measured against this tighter budget in addition to the raw byte limit.
 */
export const MAX_OUTPUT_JSON_BYTES = 96 * 1024;

export interface TruncationResult {
  content: string;
  truncated: boolean;
  truncatedBy: "bytes" | "lines" | null;
  lastLinePartial: boolean;
  outputLines: number;
  outputBytes: number;
  totalLines: number;
  totalBytes: number;
  maxBytes: number;
  maxLines: number;
}

/**
 * Metadata persisted in tool-result `details`. Mirrors `TruncationResult`
 * minus the `content` field, so the bounded preview stays in `content` only.
 */
export type TruncationDetails = Omit<TruncationResult, "content">;

interface TruncateOptions {
  maxBytes: number;
  maxLines: number;
}

/**
 * Truncate `text` from the tail, keeping the newest lines within the byte and
 * line budgets. A single oversized line is sliced to a UTF-8-safe suffix
 * rather than dropped entirely.
 */
export function truncateTail(
  text: string,
  options: TruncateOptions,
): TruncationResult {
  const { maxBytes, maxLines } = options;
  const totalBytes = Buffer.byteLength(text, "utf-8");
  const lines = text.split("\n");
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content: text,
      truncated: false,
      truncatedBy: null,
      lastLinePartial: false,
      outputLines: totalLines,
      outputBytes: totalBytes,
      totalLines,
      totalBytes,
      maxBytes,
      maxLines,
    };
  }

  // Walk backwards, keeping whole lines that fit. Track whether the byte
  // budget was the binding constraint so the notice wording is accurate.
  const kept: string[] = [];
  let keptBytes = 0;
  let hitBytes = false;

  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i] ?? "";
    const lineBytes =
      Buffer.byteLength(line, "utf-8") + (kept.length > 0 ? 1 : 0);

    if (keptBytes + lineBytes > maxBytes) {
      hitBytes = true;
      break;
    }

    kept.unshift(line);
    keptBytes += lineBytes;
  }

  let lastLinePartial = false;

  if (kept.length === 0) {
    // The newest line alone exceeds the byte budget. Keep a UTF-8-safe suffix
    // instead of returning an empty body, so the agent still sees recent
    // output. The single byte budget minus one byte for the skipped joiner.
    const lastLine = lines[lines.length - 1] ?? "";
    const suffix = utf8Suffix(lastLine, maxBytes - 1);
    kept.push(suffix);
    keptBytes = Buffer.byteLength(suffix, "utf-8");
    lastLinePartial = true;
  }

  const content = kept.join("\n");

  return {
    content,
    truncated: true,
    truncatedBy: hitBytes ? "bytes" : "lines",
    lastLinePartial,
    outputLines: kept.length,
    outputBytes: keptBytes,
    totalLines,
    totalBytes,
    maxBytes,
    maxLines,
  };
}

/**
 * Slice a UTF-8-safe suffix from `line` at most `maxBytes` long. The suffix
 * keeps the newest content (the tail of the line) and is prefixed with an
 * ellipsis marker. The cut point walks forward past any leading continuation
 * bytes (0b10xxxxxx) so the result never starts mid-code-point.
 */
function utf8Suffix(line: string, maxBytes: number): string {
  const buffer = Buffer.from(line, "utf-8");
  if (buffer.length <= maxBytes) return line;

  const marker = "…";
  const markerBytes = Buffer.byteLength(marker, "utf-8");
  const budget = Math.max(0, maxBytes - markerBytes);
  if (budget <= 0) return marker;

  // Start the cut so the suffix is the last `budget` bytes of the line.
  let start = buffer.length - budget;
  // If the cut lands inside a multibyte code point, the first byte is a
  // continuation byte (0b10xxxxxx). Walk forward to the next lead byte.
  while (start < buffer.length && (buffer[start] ?? 0) >> 6 === 0b10) {
    start++;
  }
  if (start >= buffer.length) return marker;

  return `${marker}${buffer.subarray(start).toString("utf-8")}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Count logical lines, matching `text.split("\n").length`. Empty text has
 * zero lines so the line budget is not consumed by a stray newline.
 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

/**
 * Compose a truncation notice string matching the agent-facing wording other
 * tools use, so renderers can locate it reliably.
 */
export function formatTruncationNotice(truncation: TruncationResult): string {
  if (!truncation.truncated) return "";
  const limit =
    truncation.truncatedBy === "bytes"
      ? `${formatSize(truncation.maxBytes)} byte limit`
      : `${truncation.maxLines} line limit`;
  const partialNote = truncation.lastLinePartial
    ? " (final line is a partial suffix)"
    : "";
  return `[Preview truncated by ${limit}${partialNote}; showing ${truncation.outputLines} lines / ${formatSize(truncation.outputBytes)} of ${truncation.totalLines} lines / ${formatSize(truncation.totalBytes)}.]`;
}
