/** Max bytes retained for an unterminated line before force-flush. */
export const MAX_PENDING_LINE_BYTES = 64 * 1024;
/** Max bytes retained for any single line in an event payload. */
export const MAX_LINE_BYTES = 32 * 1024;
/** Max lines carried in one process_output_changed payload. */
export const MAX_LINES_PER_EMIT = 2000;
/** Max bytes read when tailing a log file. */
export const MAX_TAIL_READ_BYTES = 2 * 1024 * 1024;
/** Max bytes retained per log file before truncate-and-restart. */
export const MAX_LOG_FILE_BYTES = 64 * 1024 * 1024;
export const TRUNCATION_SUFFIX = " … [line truncated]";
/** Max finished process records retained after the grace period. */
export const MAX_FINISHED_RECORDS = 50;
/** Keep recently finished records available to the UI before reaping. */
export const FINISHED_RECORD_GRACE_MS = 5 * 60 * 1000;
