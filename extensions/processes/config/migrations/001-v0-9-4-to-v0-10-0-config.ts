import type { Migration } from "@aliou/pi-utils-settings";

import { PROCESS_CONFIG_SCHEMA_URL } from "../schema";
import type { ProcessConfig } from "../types";

type DockDefaultStateV094 = "hidden" | "collapsed";
type DockDefaultStateV0100 = "closed" | "collapsed" | "expanded";

export interface ConfigV094 {
  $schema?: string;
  execution?: {
    shellPath?: string;
  };
  interception?: {
    blockBackgroundCommands?: boolean;
  };
  processList?: {
    maxPreviewLines?: number;
    maxVisibleProcesses?: number;
  };
  output?: {
    defaultTailLines?: number;
    maxOutputLines?: number;
  };
  follow?: {
    enabledByDefault?: boolean;
    autoHideOnFinish?: boolean;
  };
  widget?: {
    showStatusWidget?: boolean;
    dockDefaultState?: DockDefaultStateV094;
    dockHeight?: number;
  };
  keybindings?: Record<string, unknown>;
}

export interface ConfigV0100 {
  $schema?: string;
  execution?: {
    shellPath?: string;
  };
  interception?: {
    blockBackgroundCommands?: boolean;
  };
  processList?: {
    maxPreviewLines?: number;
    maxVisibleProcesses?: number;
  };
  output?: {
    defaultTailLines?: number;
    maxOutputLines?: number;
  };
  follow?: {
    enabledByDefault?: boolean;
    autoHideOnFinish?: boolean;
  };
  widget?: {
    showStatusWidget?: boolean;
    dockDefaultState?: DockDefaultStateV0100;
    dockHeight?: number;
  };
}

/**
 * Config v0.9.4 -> v0.10.0 settings migration.
 *
 * Current sections with the same shape are copied through:
 * execution, interception, processList, output, and follow.
 *
 * Widget settings changed:
 * - widget.dockDefaultState "hidden" became "closed".
 * - widget.dockHeight keeps the same key but means dock log rows.
 * - widget.showStatusWidget is preserved (still controls the status widget).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setIfDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function migrateDockDefaultState(
  value: unknown,
): DockDefaultStateV0100 | undefined {
  if (value === "hidden") return "closed";
  if (value === "closed" || value === "collapsed" || value === "expanded") {
    return value;
  }
  return undefined;
}

/** Config version this migration brings the config to. */
export const CONFIG_VERSION_V0100 = "0.10.0";

function compareSemver(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");

  for (let i = 0; i < 3; i++) {
    const diff = (Number(left[i]) || 0) - (Number(right[i]) || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

export function needsConfigV094ToV0100Migration(
  config: ProcessConfig,
  fromVersion: number | string = "0.0.0",
): boolean {
  // Gate on content and version: the v0.9.4 projection drops keys added
  // after v0.10.0, so it must never touch an already-stamped config.
  if (compareSemver(String(fromVersion), CONFIG_VERSION_V0100) >= 0) {
    return false;
  }

  const root = config as Record<string, unknown>;
  const widget = isRecord(root.widget) ? root.widget : undefined;

  return widget?.dockDefaultState === "hidden";
}

export function migrateConfigV094ToV0100(config: ConfigV094): ConfigV0100 {
  const next: ConfigV0100 = { $schema: PROCESS_CONFIG_SCHEMA_URL };

  if (config.execution) {
    const execution: NonNullable<ConfigV0100["execution"]> = {};
    setIfDefined(execution, "shellPath", config.execution.shellPath);
    setNonEmpty(next, "execution", execution);
  }

  if (config.interception) {
    const interception: NonNullable<ConfigV0100["interception"]> = {};
    setIfDefined(
      interception,
      "blockBackgroundCommands",
      config.interception.blockBackgroundCommands,
    );
    setNonEmpty(next, "interception", interception);
  }

  if (config.processList) {
    const processList: NonNullable<ConfigV0100["processList"]> = {};
    setIfDefined(
      processList,
      "maxVisibleProcesses",
      config.processList.maxVisibleProcesses,
    );
    setIfDefined(
      processList,
      "maxPreviewLines",
      config.processList.maxPreviewLines,
    );
    setNonEmpty(next, "processList", processList);
  }

  if (config.output) {
    const output: NonNullable<ConfigV0100["output"]> = {};
    setIfDefined(output, "defaultTailLines", config.output.defaultTailLines);
    setIfDefined(output, "maxOutputLines", config.output.maxOutputLines);
    setNonEmpty(next, "output", output);
  }

  if (config.follow) {
    const follow: NonNullable<ConfigV0100["follow"]> = {};
    setIfDefined(follow, "enabledByDefault", config.follow.enabledByDefault);
    setIfDefined(follow, "autoHideOnFinish", config.follow.autoHideOnFinish);
    setNonEmpty(next, "follow", follow);
  }

  if (config.widget) {
    const widget: NonNullable<ConfigV0100["widget"]> = {};
    setIfDefined(widget, "showStatusWidget", config.widget.showStatusWidget);
    setIfDefined(
      widget,
      "dockDefaultState",
      migrateDockDefaultState(config.widget.dockDefaultState),
    );
    setIfDefined(widget, "dockHeight", config.widget.dockHeight);
    setNonEmpty(next, "widget", widget);
  }

  return next;
}

function setNonEmpty<K extends keyof ConfigV0100>(
  target: ConfigV0100,
  key: K,
  value: NonNullable<ConfigV0100[K]>,
): void {
  if (Object.keys(value).length > 0) target[key] = value;
}

export const configV094ToV0100Migration: Migration<ProcessConfig> = {
  name: "001-v0-9-4-to-v0-10-0-config",
  version: CONFIG_VERSION_V0100,
  shouldRun: (config, ctx) =>
    needsConfigV094ToV0100Migration(config, ctx.fromVersion),
  run: (config) => migrateConfigV094ToV0100(config as ConfigV094),
  message:
    "Migrated pi-processes settings to the current schema. Mapped the dock hidden state to closed.",
};
