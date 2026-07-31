/**
 * Model-facing formatting of a unified-exec tool response, ported from codex
 * ExecCommandToolOutput (codex-rs/core/src/tools/context.rs):
 *   - truncated_output(max_tokens): apply the token-budget truncation policy
 *     to the collected raw output, re-inserting the head/tail omission marker
 *     if middle truncation removed it.
 *   - response_text(): the line-oriented text the model sees.
 *   - code_mode_result(): the structured output_schema object.
 *
 * One deliberate divergence from codex: modelOutputMaxTokens does not apply a
 * per-model truncation_policy.token_budget() cap, because this pi-processes
 * port has no model-info truncation policy; an explicit max_output_tokens (or
 * the codex default of 10000) is the only bound, clamped to the codex output
 * ceiling (see resolveMaxTokens).
 */

import { formatOutputOmissionMarker, resolveMaxTokens } from "./constants";
import {
  approxTokenCount,
  byteBudget,
  formattedTruncateText,
  type TruncationPolicy,
  truncateText,
} from "./truncation";

export interface ExecCommandOutput {
  /** Random chunk id; empty string suppresses the "Chunk ID" line. */
  chunkId: string;
  /** Wall time spent collecting, in ms. */
  wallTimeMs: number;
  /** Collected raw output (already head/tail-capped, with omission marker). */
  rawOutput: Buffer;
  /** Explicit token budget override, else the codex default. */
  maxOutputTokens?: number;
  /** Numeric session id shown when the process is still running, else null. */
  processId: number | null;
  /** Exit code shown when the process ended during this call, else null. */
  exitCode: number | null;
  /** Approx token count over ALL bytes observed (before head/tail omission). */
  originalTokenCount: number | null;
  /** Bytes dropped by the head/tail cap, or null if nothing was dropped. */
  outputOmittedBytes: number | null;
}

const TOKEN_POLICY = (maxTokens: number): TruncationPolicy => ({
  type: "tokens",
  tokens: maxTokens,
});

/** Resolve the effective model-facing token budget for this output. */
export function modelOutputMaxTokens(out: ExecCommandOutput): number {
  return resolveMaxTokens(out.maxOutputTokens);
}

/**
 * Apply the token-budget truncation policy to the collected output. If the
 * head/tail buffer already dropped bytes, the omission marker is preserved or
 * re-inserted across the middle-truncated result.
 */
export function truncatedOutput(
  out: ExecCommandOutput,
  maxTokens: number,
): string {
  const text = out.rawOutput.toString("utf8");
  const policy = TOKEN_POLICY(maxTokens);

  if (out.outputOmittedBytes === null) {
    return formattedTruncateText(text, policy);
  }

  const marker = formatOutputOmissionMarker(out.outputOmittedBytes);
  const budget = byteBudget(policy);
  if (Buffer.byteLength(text, "utf8") <= budget) {
    return text.includes(marker) ? text : `${marker}\n${text}`;
  }

  const originalTokenCount = out.originalTokenCount ?? approxTokenCount(text);
  const truncated = truncateText(text, policy);
  const omissionNotice = truncated.includes(marker) ? "" : `${marker}\n`;
  return `Warning: truncated output (original token count: ${originalTokenCount})\n${omissionNotice}${truncated}`;
}

/** The text content the model sees. Mirrors codex response_text. */
export function formatResponseText(out: ExecCommandOutput): string {
  const sections: string[] = [];
  if (out.chunkId) sections.push(`Chunk ID: ${out.chunkId}`);
  const wallTimeSeconds = out.wallTimeMs / 1000;
  sections.push(`Wall time: ${wallTimeSeconds.toFixed(4)} seconds`);
  if (out.exitCode !== null) {
    sections.push(`Process exited with code ${out.exitCode}`);
  }
  if (out.processId !== null) {
    sections.push(`Process running with session ID ${out.processId}`);
  }
  if (out.originalTokenCount !== null) {
    sections.push(`Original token count: ${out.originalTokenCount}`);
  }
  sections.push("Output:");
  sections.push(truncatedOutput(out, modelOutputMaxTokens(out)));
  return sections.join("\n");
}

/** Structured result matching codex unified_exec_output_schema. */
export function formatCodeModeResult(out: ExecCommandOutput): {
  chunk_id?: string;
  wall_time_seconds: number;
  exit_code?: number;
  session_id?: number;
  original_token_count?: number;
  output: string;
} {
  return {
    ...(out.chunkId ? { chunk_id: out.chunkId } : {}),
    wall_time_seconds: out.wallTimeMs / 1000,
    ...(out.exitCode !== null ? { exit_code: out.exitCode } : {}),
    ...(out.processId !== null ? { session_id: out.processId } : {}),
    ...(out.originalTokenCount !== null
      ? { original_token_count: out.originalTokenCount }
      : {}),
    output: truncatedOutput(out, modelOutputMaxTokens(out)),
  };
}
