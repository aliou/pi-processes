/**
 * Codex-parity constants for the unified-exec session model.
 *
 * Direct port of codex-rs/core/src/unified_exec/{mod.rs,process.rs,
 * process_manager.rs}. No pi-flavor divergences: every default matches codex.
 *
 * The only host-repo concern (not a codex semantic) is the `enabled`
 * settings gate, which lives in the extension config, not here.
 */

// mod.rs --------------------------------------------------------------------

/** Minimum yield time for exec_command and non-empty write_stdin. */
export const MIN_YIELD_TIME_MS = 250;

/** Minimum yield time for an empty (poll-only) write_stdin. */
export const MIN_EMPTY_YIELD_TIME_MS = 5_000;

/** Maximum yield time for any single collect window. */
export const MAX_YIELD_TIME_MS = 30_000;

/**
 * Default maximum background terminal timeout: the upper bound for an empty
 * write_stdin poll. Matches codex DEFAULT_MAX_BACKGROUND_TERMINAL_TIMEOUT_MS
 * (30 min). This is a ceiling the model must request explicitly; the daily
 * defaults are 10 s (exec_command) and 250 ms (write_stdin).
 */
export const DEFAULT_MAX_BACKGROUND_POLL_MS = 300_000;

/** Default output token budget passed to the model-facing truncation policy. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;

/** In-memory head+tail drain buffer cap per session (codex: 1 MiB). */
export const UNIFIED_EXEC_OUTPUT_MAX_BYTES = 1024 * 1024;

/** Upper bound on max_output_tokens for a single tool response. */
export const UNIFIED_EXEC_OUTPUT_MAX_TOKENS = UNIFIED_EXEC_OUTPUT_MAX_BYTES / 4;

/** Maximum number of concurrently live unified-exec sessions. */
export const MAX_UNIFIED_EXEC_PROCESSES = 64;

// process.rs ---------------------------------------------------------------

/** Grace period allowed after a short-lived command exits before closing. */
export const EARLY_EXIT_GRACE_PERIOD_MS = 150;

// process_manager.rs (collect_output_until_deadline) ----------------------

/** Cap on the post-exit close wait inside the collect loop. */
export const POST_EXIT_CLOSE_WAIT_MS = 50;

// Helpers (mirror mod.rs) -------------------------------------------------

/**
 * Clamp a relative yield time to [MIN_YIELD_TIME_MS, MAX_YIELD_TIME_MS].
 * Mirrors codex clamp_yield_time (POSIX path; the Windows floor is skipped
 * because this extension is POSIX-only like the rest of pi-processes).
 */
export function clampYieldTime(yieldTimeMs: number): number {
  return Math.min(MAX_YIELD_TIME_MS, Math.max(MIN_YIELD_TIME_MS, yieldTimeMs));
}

/**
 * Resolve the effective output token budget. Mirrors codex resolve_max_tokens:
 * an explicit value wins, otherwise the default.
 */
export function resolveMaxTokens(maxTokens: number | undefined): number {
  return maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Clamp a write_stdin yield time. Mirrors the process_manager.rs logic: empty
 * polls use [MIN_EMPTY_YIELD_TIME_MS, maxBackgroundPollMs]; non-empty writes
 * use [MIN_YIELD_TIME_MS, MAX_YIELD_TIME_MS].
 */
export function clampPassiveYield(
  input: string,
  yieldTimeMs: number,
  maxBackgroundPollMs: number,
): number {
  const timeMs = Math.max(MIN_YIELD_TIME_MS, yieldTimeMs);
  if (input.length === 0) {
    return Math.min(
      Math.max(timeMs, MIN_EMPTY_YIELD_TIME_MS),
      maxBackgroundPollMs,
    );
  }
  return Math.min(timeMs, MAX_YIELD_TIME_MS);
}

/**
 * Omission marker inserted between the retained head and tail by
 * HeadTailBuffer.toBytesWithOmissionMarker. Mirrors codex
 * format_output_omission_marker.
 */
export function formatOutputOmissionMarker(omittedBytes: number): string {
  return `... ${omittedBytes} bytes omitted ...`;
}

/** Generate a 6-hex-char chunk id. Mirrors codex generate_chunk_id. */
export function generateChunkId(): string {
  let id = "";
  for (let i = 0; i < 6; i += 1) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id;
}
