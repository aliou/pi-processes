import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

import type { ProcessInfo } from "../../../src/types";
import {
  formatRuntime,
  formatStatus,
  formatTimestamp,
  shortenPath,
} from "../../../src/utils";
import {
  sanitizeForDisplay,
  truncateForDisplay,
} from "../../shared/display-text";
import { statusColor } from "../../shared/ui";

export interface RenderOptions {
  expanded?: boolean;
}

export function buildField(
  label: string,
  value: string | number | null,
  theme: Theme,
): Text {
  return new Text(
    `${theme.fg("muted", `${label}:`)} ${String(value ?? "-")}`,
    0,
    0,
  );
}

export function buildCommandField(
  command: string,
  theme: Theme,
  options?: { truncate?: boolean },
): Text {
  const value = options?.truncate
    ? truncateForDisplay(command, 80)
    : sanitizeForDisplay(command);
  return buildField("command", theme.fg("accent", `\`${value}\``), theme);
}

export function buildProcessDetails(
  process: ProcessInfo,
  theme: Theme,
  options?: { runtime?: boolean },
): Container {
  const container = new Container();
  container.addChild(buildField("id", process.id, theme));
  container.addChild(
    buildField("name", sanitizeForDisplay(process.name), theme),
  );
  container.addChild(
    buildField("status", formatColoredProcessStatus(process, theme), theme),
  );
  container.addChild(buildField("pid", process.pid, theme));
  if (options?.runtime !== false) {
    container.addChild(
      buildField("duration", formatProcessRuntime(process), theme),
    );
  }
  container.addChild(
    buildField("started", formatTimestamp(process.startTime), theme),
  );
  container.addChild(
    buildField("cwd", sanitizeForDisplay(shortenPath(process.cwd)), theme),
  );
  container.addChild(buildCommandField(process.command, theme));
  container.addChild(buildField("stdout", process.stdoutFile, theme));
  container.addChild(buildField("stderr", process.stderrFile, theme));
  return container;
}

export function buildProcessSummaryRow(
  process: ProcessInfo,
  theme: Theme,
): Text {
  return new Text(
    [
      sanitizeForDisplay(process.name),
      theme.fg("accent", process.id),
      `pid ${process.pid}`,
      formatColoredProcessStatus(process, theme),
    ].join("  "),
    0,
    0,
  );
}

export function buildCompactProcessLine(
  process: ProcessInfo,
  theme: Theme,
): Text {
  return buildField("process", `${process.id} / pid ${process.pid}`, theme);
}

export function formatProcessRuntime(
  process: ProcessInfo,
  now?: number,
): string {
  if (process.startTime <= 0) return "-";
  return formatRuntime(process.startTime, process.endTime, now);
}

export function formatColoredProcessStatus(
  process: ProcessInfo,
  theme: Theme,
): string {
  return theme.fg(statusColor(process), formatStatus(process));
}

export function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}

export function formatCount(count: number, singular: string): string {
  return `${count} ${plural(singular, count)}`;
}
