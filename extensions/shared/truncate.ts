import { visibleWidth } from "@earendil-works/pi-tui";

/**
 * Wrap text to `maxWidth` display cells, returning one string per row.
 *
 * Walks graphemes like `truncateToWidth`, expands tabs to 3-column stops,
 * handles wide characters (never splits one across a row boundary), and
 * carries open SGR state across wrapped chunks so colours survive wrapping.
 *
 * Each returned chunk is padded to its row width and closed with a reset if
 * any SGR is left open, matching the contract of `truncateToWidth(_, _, "", true)`.
 *
 * When `contIndent` > 0, the first row wraps to `maxWidth` and every
 * continuation row wraps to `maxWidth - contIndent` (the caller prepends the
 * indent prefix to those rows). This mirrors `less` narrowing wrapped rows.
 */
export function wrapToWidth(
  text: string,
  maxWidth: number,
  contIndent = 0,
): string[] {
  if (maxWidth <= 0) return [];
  const contWidth = Math.max(1, maxWidth - contIndent);
  if (text.length === 0) return [" ".repeat(maxWidth)];

  if (isPrintableAscii(text)) {
    const rows: string[] = [];
    let rowWidth = maxWidth;
    let index = 0;
    while (index < text.length) {
      const slice = text.slice(index, index + rowWidth);
      rows.push(slice + " ".repeat(rowWidth - slice.length));
      index += rowWidth;
      rowWidth = contWidth; // continuation rows are narrower
    }
    return rows;
  }

  const hasAnsi = text.includes("\u001b");
  const hasTabs = text.includes("\t");

  if (!hasAnsi && !hasTabs) {
    return wrapPlainGraphemes(text, maxWidth, contWidth);
  }

  return wrapWithAnsiAndTabs(text, maxWidth, contWidth);
}

function wrapPlainGraphemes(
  text: string,
  firstWidth: number,
  contWidth: number,
): string[] {
  const rows: string[] = [];
  let current = "";
  let width = 0;
  let rowWidth = firstWidth;

  for (const { segment } of segmenter.segment(text)) {
    const segmentWidth = visibleWidth(segment);
    if (width + segmentWidth > rowWidth && current.length > 0) {
      rows.push(current + " ".repeat(rowWidth - width));
      current = "";
      width = 0;
      rowWidth = contWidth;
    }
    current += segment;
    width += segmentWidth;
  }

  rows.push(current + " ".repeat(rowWidth - width));
  return rows;
}

function wrapWithAnsiAndTabs(
  text: string,
  firstWidth: number,
  contWidth: number,
): string[] {
  const ESCAPE = "\u001b";
  const RESET = `${ESCAPE}[0m`;
  const SGR_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;:]*m`, "u");
  const rows: string[] = [];
  let current = "";
  let width = 0;
  let rowWidth = firstWidth;
  let pendingAnsi = "";
  /** SGR sequences seen so far that are still "open" (not reset). */
  let openSgr = "";

  const flushRow = () => {
    const padded = current + " ".repeat(rowWidth - width);
    // Close any open SGR so colour does not bleed into the padding or the
    // next row. The continuation row will re-open it.
    if (openSgr && !padded.trimEnd().endsWith(RESET)) {
      rows.push(`${padded}${RESET}`);
    } else {
      rows.push(padded);
    }
    current = "";
    width = 0;
    rowWidth = contWidth;
  };

  let index = 0;
  while (index < text.length) {
    const ansi = readAnsiSequence(text, index);
    if (ansi) {
      pendingAnsi += ansi;
      // Track SGR state: a reset clears open styles; any other SGR
      // accumulates so we can re-emit it at the start of continuation rows.
      if (SGR_PATTERN.test(ansi)) {
        if (ansi === RESET) {
          openSgr = "";
        } else {
          openSgr += ansi;
        }
      }
      index += ansi.length;
      continue;
    }

    if (text[index] === "\t") {
      const tabWidth = 3;
      if (width + tabWidth > rowWidth && current.length > 0) {
        if (pendingAnsi) {
          current += pendingAnsi;
          pendingAnsi = "";
        }
        flushRow();
        // Re-emit open SGR at the start of the continuation row.
        if (openSgr) {
          current = openSgr;
        }
      }
      if (pendingAnsi) {
        current += pendingAnsi;
        pendingAnsi = "";
      }
      current += "   ";
      width += tabWidth;
      index++;
      continue;
    }

    // Gather a run of non-ANSI, non-tab characters, then segment it.
    let end = index;
    while (end < text.length && text[end] !== "\t") {
      const nextAnsi = readAnsiSequence(text, end);
      if (nextAnsi) break;
      end++;
    }

    for (const { segment } of segmenter.segment(text.slice(index, end))) {
      const segmentWidth = visibleWidth(segment);
      if (width + segmentWidth > rowWidth && current.length > 0) {
        if (pendingAnsi) {
          current += pendingAnsi;
          pendingAnsi = "";
        }
        flushRow();
        // Re-emit open SGR at the start of the continuation row.
        if (openSgr) {
          current = openSgr;
        }
      }
      if (pendingAnsi) {
        current += pendingAnsi;
        pendingAnsi = "";
      }
      current += segment;
      width += segmentWidth;
    }

    index = end;
  }

  // Flush the final row.
  if (pendingAnsi) {
    current += pendingAnsi;
  }
  const padded = current + " ".repeat(rowWidth - width);
  if (openSgr && !padded.trimEnd().endsWith(RESET)) {
    rows.push(`${padded}${RESET}`);
  } else {
    rows.push(padded);
  }

  return rows;
}

export function truncateToWidth(
  text: string,
  maxWidth: number,
  ellipsis = "…",
  pad = false,
): string {
  if (maxWidth <= 0) return "";
  if (text.length === 0) return pad ? " ".repeat(maxWidth) : "";

  const ellipsisWidth = visibleWidth(ellipsis);
  if (ellipsisWidth >= maxWidth) {
    const textWidth = visibleWidth(text);
    if (textWidth <= maxWidth) {
      return pad ? text + " ".repeat(maxWidth - textWidth) : text;
    }

    const clippedEllipsis = truncateFragmentToWidth(ellipsis, maxWidth);
    if (clippedEllipsis.width === 0) {
      return pad ? " ".repeat(maxWidth) : "";
    }

    return finalizeTruncatedResult(
      "",
      0,
      clippedEllipsis.text,
      clippedEllipsis.width,
      maxWidth,
      pad,
    );
  }

  if (isPrintableAscii(text)) {
    if (text.length <= maxWidth) {
      return pad ? text + " ".repeat(maxWidth - text.length) : text;
    }

    const targetWidth = maxWidth - ellipsisWidth;
    return finalizeTruncatedResult(
      text.slice(0, targetWidth),
      targetWidth,
      ellipsis,
      ellipsisWidth,
      maxWidth,
      pad,
    );
  }

  const targetWidth = maxWidth - ellipsisWidth;
  let result = "";
  let visibleSoFar = 0;
  let keptWidth = 0;
  let keepContiguousPrefix = true;
  let overflowed = false;
  let exhaustedInput = false;
  const hasAnsi = text.includes("\u001b");
  const hasTabs = text.includes("\t");

  if (!hasAnsi && !hasTabs) {
    for (const { segment } of segmenter.segment(text)) {
      const width = visibleWidth(segment);
      if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
        result += segment;
        keptWidth += width;
      } else {
        keepContiguousPrefix = false;
      }

      visibleSoFar += width;
      if (visibleSoFar > maxWidth) {
        overflowed = true;
        break;
      }
    }
    exhaustedInput = !overflowed;
  } else {
    let index = 0;
    let pendingAnsi = "";
    while (index < text.length) {
      const ansi = readAnsiSequence(text, index);
      if (ansi) {
        pendingAnsi += ansi;
        index += ansi.length;
        continue;
      }

      if (text[index] === "\t") {
        if (keepContiguousPrefix && keptWidth + 3 <= targetWidth) {
          if (pendingAnsi) {
            result += pendingAnsi;
            pendingAnsi = "";
          }
          result += "\t";
          keptWidth += 3;
        } else {
          keepContiguousPrefix = false;
          pendingAnsi = "";
        }

        visibleSoFar += 3;
        if (visibleSoFar > maxWidth) {
          overflowed = true;
          break;
        }
        index++;
        continue;
      }

      let end = index;
      while (end < text.length && text[end] !== "\t") {
        const nextAnsi = readAnsiSequence(text, end);
        if (nextAnsi) break;
        end++;
      }

      for (const { segment } of segmenter.segment(text.slice(index, end))) {
        const width = visibleWidth(segment);
        if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
          if (pendingAnsi) {
            result += pendingAnsi;
            pendingAnsi = "";
          }
          result += segment;
          keptWidth += width;
        } else {
          keepContiguousPrefix = false;
          pendingAnsi = "";
        }

        visibleSoFar += width;
        if (visibleSoFar > maxWidth) {
          overflowed = true;
          break;
        }
      }

      if (overflowed) break;
      index = end;
    }
    exhaustedInput = index >= text.length;
  }

  if (!overflowed && exhaustedInput) {
    return pad ? text + " ".repeat(Math.max(0, maxWidth - visibleSoFar)) : text;
  }

  return finalizeTruncatedResult(
    result,
    keptWidth,
    ellipsis,
    ellipsisWidth,
    maxWidth,
    pad,
  );
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function isPrintableAscii(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

function truncateFragmentToWidth(
  text: string,
  maxWidth: number,
): { text: string; width: number } {
  if (maxWidth <= 0 || text.length === 0) {
    return { text: "", width: 0 };
  }

  if (isPrintableAscii(text)) {
    const clipped = text.slice(0, maxWidth);
    return { text: clipped, width: clipped.length };
  }

  const hasAnsi = text.includes("\u001b");
  const hasTabs = text.includes("\t");
  if (!hasAnsi && !hasTabs) {
    let result = "";
    let width = 0;

    for (const { segment } of segmenter.segment(text)) {
      const segmentWidth = visibleWidth(segment);
      if (width + segmentWidth > maxWidth) break;
      result += segment;
      width += segmentWidth;
    }

    return { text: result, width };
  }

  let result = "";
  let width = 0;
  let index = 0;
  let pendingAnsi = "";

  while (index < text.length) {
    const ansi = readAnsiSequence(text, index);
    if (ansi) {
      pendingAnsi += ansi;
      index += ansi.length;
      continue;
    }

    if (text[index] === "\t") {
      if (width + 3 > maxWidth) break;
      if (pendingAnsi) {
        result += pendingAnsi;
        pendingAnsi = "";
      }
      result += "\t";
      width += 3;
      index++;
      continue;
    }

    let end = index;
    while (end < text.length && text[end] !== "\t") {
      const nextAnsi = readAnsiSequence(text, end);
      if (nextAnsi) break;
      end++;
    }

    for (const { segment } of segmenter.segment(text.slice(index, end))) {
      const segmentWidth = visibleWidth(segment);
      if (width + segmentWidth > maxWidth) {
        return { text: result, width };
      }
      if (pendingAnsi) {
        result += pendingAnsi;
        pendingAnsi = "";
      }
      result += segment;
      width += segmentWidth;
    }

    index = end;
  }

  return { text: result, width };
}

function finalizeTruncatedResult(
  prefix: string,
  prefixWidth: number,
  ellipsis: string,
  ellipsisWidth: number,
  maxWidth: number,
  pad: boolean,
): string {
  const width = prefixWidth + ellipsisWidth;
  const result = ellipsis.length > 0 ? `${prefix}${ellipsis}` : prefix;
  return pad ? result + " ".repeat(Math.max(0, maxWidth - width)) : result;
}

function readAnsiSequence(text: string, index: number): string | null {
  const ESCAPE = "\u001b";
  if (text[index] !== ESCAPE) return null;

  const next = text[index + 1];
  if (next === "[") {
    const code = text.slice(index);
    const pattern = new RegExp(`^${ESCAPE}\\[[0-?]*[ -/]*[@-~]`, "u");
    const match = code.match(pattern);
    return match?.[0] ?? text[index];
  }

  if (next === "]" || next === "_") {
    const rest = text.slice(index);
    const bel = rest.indexOf("\u0007");
    const st = rest.indexOf("\u001b\\");
    const end = [bel, st]
      .filter((value) => value >= 0)
      .sort((a, b) => a - b)[0];
    if (end === undefined) return text[index];
    return rest.slice(0, end + (end === st ? 2 : 1));
  }

  return text.slice(index, Math.min(index + 2, text.length));
}
