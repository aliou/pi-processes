/**
 * Shared extension-UI primitives used across the processes, processes-logs,
 * and processes-dock extensions.
 *
 * This module lives outside pi-agnostic `src/` because it depends on the Pi
 * TUI (`Component`, `Theme`). It consolidates the tiny render-component
 * copies and the status-display helpers that were duplicated across the three
 * extensions.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import { LIVE_STATUSES, type ProcessInfo } from "../../src/types";
import { formatStatus } from "../../src/utils/format";

// ---------------------------------------------------------------------------
// Render components
// ---------------------------------------------------------------------------

/** Render a single line produced by a width-aware callback. */
export class LineComponent implements Component {
  constructor(private readonly renderLine: (width: number) => string) {}

  render(width: number): string[] {
    return [this.renderLine(width)];
  }

  invalidate(): void {}
}

/** Render multiple lines produced by a width-aware callback. */
export class LinesComponent implements Component {
  constructor(private readonly renderLines: (width: number) => string[]) {}

  render(width: number): string[] {
    return this.renderLines(width);
  }

  invalidate(): void {}
}

/** Render a horizontal rule line sized to the available width. */
export class RuleComponent implements Component {
  constructor(private readonly theme: Theme) {}

  render(width: number): string[] {
    return [this.theme.fg("dim", "─".repeat(Math.max(0, width)))];
  }

  invalidate(): void {}
}

// ---------------------------------------------------------------------------
// Status formatting
// ---------------------------------------------------------------------------

export type ProcessStatusTone = "success" | "warning" | "error" | "muted";

/**
 * Resolve the tone for a process's current status. Shared so the overview,
 * dock, and output tool agree on coloring.
 */
export function processStatusTone(process: ProcessInfo): ProcessStatusTone {
  if (process.status === "running") return "success";
  if (process.status === "terminating") return "warning";
  if (process.status === "terminate_timeout") return "error";
  if (process.status === "killed") return "warning";
  return process.success ? "muted" : "error";
}

/**
 * Render the status indicator dot for a process.
 *
 * - `!` (error) for failures/crashes, unless the process was intentionally
 *   killed.
 * - `●` (warning) for terminating.
 * - `●`/`○` (accent/dim) for live processes, depending on `active`.
 * - `●` (success) for a clean exit.
 * - `■` (dim) for other terminal states (e.g. killed).
 */
export function statusDot(
  process: ProcessInfo,
  active: boolean,
  theme: Theme,
): string {
  if (process.success === false && process.status !== "killed") {
    return theme.fg("error", "!");
  }
  if (process.status === "terminating") {
    return theme.fg("warning", "●");
  }
  if (LIVE_STATUSES.has(process.status)) {
    return active ? theme.fg("accent", "●") : theme.fg("dim", "○");
  }
  if (process.status === "exited" && process.success) {
    return theme.fg("success", "●");
  }
  return theme.fg("dim", "■");
}

/**
 * Build the `description` string for process picker items and autocomplete
 * completions: `"running — pnpm dev"`. Shared so `/ps:kill`, `/ps:logs`,
 * `/ps:pin`, and the logs completions stay consistent.
 */
export function formatProcessSelectionDescription(
  process: ProcessInfo,
  suffix = "",
): string {
  const base = `${formatStatus(process)} — ${process.command}`;
  return suffix ? `${base}${suffix}` : base;
}
