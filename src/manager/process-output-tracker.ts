import type {
  LogWatch,
  LogWatchMode,
  LogWatchStream,
  ManagerEvent,
} from "../types";
import type { ManagedProcess, ResolvedWatch } from "./internal-types";

const MAX_LOG_WATCHES = 20;
const MAX_LOG_WATCH_PATTERN_LENGTH = 500;
const MAX_LOG_WATCH_MATCH_LINE_LENGTH = 10_000;

/*
 * Log watch ReDoS policy
 *
 * Log watches are LLM-provided input. They are not user-entered UI filters, and
 * they can be evaluated against every completed stdout/stderr line for a
 * long-running process. That makes native JavaScript RegExp a possible CPU sink:
 * a single catastrophic pattern can stall the extension if it is tested against
 * a hostile or simply unlucky log line.
 *
 * Current Phase 1 behavior is deliberately conservative without adding another
 * dependency yet:
 *
 * - The default mode is "literal", not "regex". Literal mode escapes the
 *   pattern before compiling, so punctuation like "(" or ".*" is matched as
 *   text and cannot introduce backtracking behavior.
 * - Regex mode is explicit: callers must pass `mode: "regex"` to request native
 *   RegExp semantics.
 * - Pattern count, pattern length, and matched line length are bounded. These
 *   caps do not prove regex safety, but they reduce the blast radius until the
 *   stronger validator is added.
 *
 * Follow-up ReDoS hardening after Phase 1:
 *
 * 1. Add a validator in this file, at the regex-mode boundary below, before
 *    `new RegExp(pattern)` runs.
 * 2. Preferred lightweight guard: `safe-regex2(pattern, { limit: 25 })`.
 *    It is a Fastify-maintained heuristic that catches common nested-repeat
 *    catastrophic patterns. It has false positives and false negatives, so keep
 *    the existing literal default and caps even after adding it.
 * 3. If we need stronger diagnostics later, evaluate `redos-detector` either as
 *    a replacement or as a stricter/dev-only pass with explicit timeout/step
 *    limits.
 * 4. Avoid native `re2` here unless the project accepts native build tooling.
 *    That is a bad fit for this repo's macOS/arm64 + Nix constraints.
 * 5. Be careful with `re2js`: it gives safer linear-time matching, but it
 *    changes supported syntax and semantics. If adopted, it should be a
 *    deliberate API choice, not a silent replacement for JS regex mode.
 */

interface ProcessOutputTrackerDeps {
  emit: (event: ManagerEvent) => void;
  appendCombinedLine: (
    combinedFile: string,
    source: "stdout" | "stderr",
    line: string,
  ) => void;
}

export class ProcessOutputTracker {
  private emit: (event: ManagerEvent) => void;
  private appendCombinedLine: (
    combinedFile: string,
    source: "stdout" | "stderr",
    line: string,
  ) => void;

  constructor(deps: ProcessOutputTrackerDeps) {
    this.emit = deps.emit;
    this.appendCombinedLine = deps.appendCombinedLine;
  }

  resolveLogWatches(input?: LogWatch[]): ResolvedWatch[] {
    if (!input || input.length === 0) return [];
    if (input.length > MAX_LOG_WATCHES) {
      throw new Error(`logWatches supports at most ${MAX_LOG_WATCHES} entries`);
    }

    return input.map((watch, index) => {
      const pattern = watch.pattern?.trim();
      if (!pattern) {
        throw new Error(`logWatches[${index}].pattern is required`);
      }
      if (pattern.length > MAX_LOG_WATCH_PATTERN_LENGTH) {
        throw new Error(
          `logWatches[${index}].pattern must be ${MAX_LOG_WATCH_PATTERN_LENGTH} characters or fewer`,
        );
      }

      const mode: LogWatchMode = watch.mode ?? "literal";
      if (mode !== "literal" && mode !== "regex") {
        throw new Error(
          `Invalid logWatches[${index}].mode: ${mode}. Expected literal or regex`,
        );
      }

      let regex: RegExp;
      try {
        regex =
          mode === "literal"
            ? new RegExp(escapeRegExp(pattern))
            : new RegExp(pattern);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "invalid regular expression";
        throw new Error(
          `Invalid log watch pattern at logWatches[${index}]: ${message}`,
        );
      }

      const stream: LogWatchStream = watch.stream ?? "both";
      if (stream !== "stdout" && stream !== "stderr" && stream !== "both") {
        throw new Error(
          `Invalid logWatches[${index}].stream: ${stream}. Expected stdout, stderr, or both`,
        );
      }

      return {
        index,
        pattern,
        mode,
        regex,
        stream,
        repeat: watch.repeat ?? false,
        fired: false,
      };
    });
  }

  onStdoutChunk(managed: ManagedProcess, data: Buffer): string[] {
    const lines = this.extractCompleteLines(managed, "stdout", data);
    for (const line of lines) {
      this.appendCombinedLine(managed.combinedFile, "stdout", line);
      managed.appendedLines.push({ type: "stdout", text: line });
    }
    this.matchWatches(managed, "stdout", lines);
    return lines;
  }

  onStderrChunk(managed: ManagedProcess, data: Buffer): string[] {
    const lines = this.extractCompleteLines(managed, "stderr", data);
    for (const line of lines) {
      this.appendCombinedLine(managed.combinedFile, "stderr", line);
      managed.appendedLines.push({ type: "stderr", text: line });
    }
    this.matchWatches(managed, "stderr", lines);
    return lines;
  }

  flushPendingLines(managed: ManagedProcess): void {
    if (managed.stdoutPendingLine) {
      this.appendCombinedLine(
        managed.combinedFile,
        "stdout",
        managed.stdoutPendingLine,
      );
      this.matchWatches(managed, "stdout", [managed.stdoutPendingLine]);
      managed.appendedLines.push({
        type: "stdout",
        text: managed.stdoutPendingLine,
      });
      managed.stdoutPendingLine = "";
    }

    if (managed.stderrPendingLine) {
      this.appendCombinedLine(
        managed.combinedFile,
        "stderr",
        managed.stderrPendingLine,
      );
      this.matchWatches(managed, "stderr", [managed.stderrPendingLine]);
      managed.appendedLines.push({
        type: "stderr",
        text: managed.stderrPendingLine,
      });
      managed.stderrPendingLine = "";
    }
  }

  drainAppendedLines(
    managed: ManagedProcess,
  ): Array<{ type: "stdout" | "stderr"; text: string }> | undefined {
    if (managed.appendedLines.length === 0) return undefined;
    const lines = managed.appendedLines;
    managed.appendedLines = [];
    return lines;
  }

  private extractCompleteLines(
    managed: ManagedProcess,
    source: "stdout" | "stderr",
    data: Buffer,
  ): string[] {
    const chunk = data.toString();
    const pending =
      source === "stdout"
        ? managed.stdoutPendingLine
        : managed.stderrPendingLine;
    const merged = pending + chunk;
    const parts = merged.split(/\r?\n/);
    const completeLines = parts.slice(0, -1);
    const nextPending = parts[parts.length - 1] ?? "";

    if (source === "stdout") {
      managed.stdoutPendingLine = nextPending;
    } else {
      managed.stderrPendingLine = nextPending;
    }

    return completeLines;
  }

  private matchWatches(
    managed: ManagedProcess,
    source: "stdout" | "stderr",
    lines: string[],
  ): void {
    if (managed.watches.length === 0 || lines.length === 0) return;

    for (const line of lines) {
      if (line.length > MAX_LOG_WATCH_MATCH_LINE_LENGTH) continue;

      for (const watch of managed.watches) {
        if (!watch.repeat && watch.fired) continue;
        if (watch.stream !== "both" && watch.stream !== source) continue;

        if (!watch.regex.test(line)) continue;

        watch.fired = true;

        this.emit({
          type: "process_watch_matched",
          match: {
            processId: managed.id,
            processName: managed.name,
            processCommand: managed.command,
            source,
            line,
            watch: {
              index: watch.index,
              pattern: watch.pattern,
              mode: watch.mode,
              stream: watch.stream,
              repeat: watch.repeat,
            },
          },
        });
      }
    }
  }

  [Symbol.dispose](): void {
    // No state to clean up -- watches are owned by ManagedProcess.
  }
}

function escapeRegExp(pattern: string): string {
  return pattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
