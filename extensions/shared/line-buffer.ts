export const OUTPUT_DROPPED_MARKER_TYPE = "stderr" as const;

export function buildDroppedOutputLine(count: number): {
  type: typeof OUTPUT_DROPPED_MARKER_TYPE;
  text: string;
} {
  return {
    type: OUTPUT_DROPPED_MARKER_TYPE,
    text: `… ${count} lines dropped (output too fast)`,
  };
}

export function trimToBudget<T>(
  lines: T[],
  maxLines: number,
  maxBytes: number,
  textOf: (line: T) => string = (line) => (line as { text: string }).text,
): T[] {
  if (lines.length === 0) return [];

  const lineLimit = Math.max(1, maxLines);
  const out =
    lines.length > lineLimit ? lines.slice(-lineLimit) : lines.slice();
  let bytes = 0;

  for (let index = out.length - 1; index >= 0; index--) {
    bytes += Buffer.byteLength(textOf(out[index]), "utf-8");
    if (bytes > maxBytes) {
      // Keep the newest line even when it alone exceeds the whole budget.
      return index === out.length - 1 ? out.slice(index) : out.slice(index + 1);
    }
  }

  return out;
}
