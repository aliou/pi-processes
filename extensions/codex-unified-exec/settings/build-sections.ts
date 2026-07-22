/**
 * Build settings sections for codex-unified-exec.
 *
 * The first-level view stays focused: an enable toggle plus a single Advanced
 * detail editor for the session and output caps (which all mirror codex
 * constants).
 */

import {
  type Scope,
  SettingsDetailEditor,
  type SettingsSection,
  type SettingsTheme,
} from "@aliou/pi-utils-settings";
import type { SettingItem } from "@earendil-works/pi-tui";

import type { CodexExecConfig, CodexExecProtocolConfig } from "../config";

interface BuildSectionsContext {
  setDraft: (config: CodexExecConfig) => void;
  scope: Scope;
  isInherited: (path: string) => boolean;
  theme: SettingsTheme;
}

export function buildSections(
  tabConfig: CodexExecConfig | null,
  resolved: CodexExecProtocolConfig,
  ctx: BuildSectionsContext,
): SettingsSection[] {
  const scopedConfig = structuredClone(tabConfig ?? {}) as CodexExecConfig;

  const coreSection: SettingsSection = {
    label: "Core",
    items: [
      boolItem(
        "enabled",
        "Codex unified exec",
        "Expose the codex unified_exec tools (exec_command, write_stdin) that emulate OpenAI Codex's interactive session model over pi-processes. Disabled by default.",
        scopedConfig.enabled,
        resolved.enabled,
      ),
      buildAdvancedDetailItem(scopedConfig, resolved, ctx),
    ],
  };

  return [coreSection];
}

function buildAdvancedDetailItem(
  scopedConfig: CodexExecConfig,
  resolved: CodexExecProtocolConfig,
  ctx: BuildSectionsContext,
): SettingItem {
  const maxSessions =
    scopedConfig.sessions?.maxSessions ?? resolved.sessions.maxSessions;
  const maxBackgroundPollMs =
    scopedConfig.sessions?.maxBackgroundPollMs ??
    resolved.sessions.maxBackgroundPollMs;
  const maxBytes = scopedConfig.output?.maxBytes ?? resolved.output.maxBytes;
  const defaultMaxOutputTokens =
    scopedConfig.output?.defaultMaxOutputTokens ??
    resolved.output.defaultMaxOutputTokens;

  return {
    id: "advanced.details",
    label: "Advanced",
    currentValue: `${maxSessions} sessions · ${maxBackgroundPollMs} ms poll · ${formatBytes(maxBytes)} buffer`,
    description:
      "Open focused settings for the session cap, empty-poll ceiling, output buffer size, and default token budget.",
    submenu: (_current, done) => {
      const current = scopedConfig;
      let nextMaxSessions = String(maxSessions);
      let nextMaxBackgroundPollMs = String(maxBackgroundPollMs);
      let nextMaxBytes = String(maxBytes);
      let nextDefaultMaxOutputTokens = String(defaultMaxOutputTokens);

      const syncDraft = () => {
        ctx.setDraft({
          ...current,
          sessions: {
            ...current.sessions,
            maxSessions: parsePositiveInt(nextMaxSessions),
            maxBackgroundPollMs: parsePositiveInt(nextMaxBackgroundPollMs),
          },
          output: {
            ...current.output,
            maxBytes: parsePositiveInt(nextMaxBytes),
            defaultMaxOutputTokens: parsePositiveInt(
              nextDefaultMaxOutputTokens,
            ),
          },
        });
      };

      return new SettingsDetailEditor({
        title: "Advanced",
        theme: ctx.theme,
        fields: [
          {
            id: "sessions.maxSessions",
            type: "text",
            label: "Max sessions",
            description:
              "Maximum number of concurrently live unified-exec sessions. Codex default is 64.",
            getValue: () => nextMaxSessions,
            setValue: (value) => {
              nextMaxSessions = value;
              syncDraft();
            },
            validate: positiveIntegerError,
          },
          {
            id: "sessions.maxBackgroundPollMs",
            type: "text",
            label: "Empty-poll ceiling (ms)",
            description:
              "Upper bound for an empty write_stdin poll, in milliseconds. Codex default is 300000 (30 min).",
            getValue: () => nextMaxBackgroundPollMs,
            setValue: (value) => {
              nextMaxBackgroundPollMs = value;
              syncDraft();
            },
            validate: positiveIntegerError,
          },
          {
            id: "output.maxBytes",
            type: "text",
            label: "Output buffer (bytes)",
            description:
              "Per-session head+tail buffer cap in bytes. Codex default is 1048576 (1 MiB).",
            getValue: () => nextMaxBytes,
            setValue: (value) => {
              nextMaxBytes = value;
              syncDraft();
            },
            validate: positiveIntegerError,
          },
          {
            id: "output.defaultMaxOutputTokens",
            type: "text",
            label: "Default output tokens",
            description:
              "Default output token budget passed to the model-facing truncation policy. Codex default is 10000.",
            getValue: () => nextDefaultMaxOutputTokens,
            setValue: (value) => {
              nextDefaultMaxOutputTokens = value;
              syncDraft();
            },
            validate: positiveIntegerError,
          },
        ],
        getDoneSummary: () =>
          `${parsePositiveInt(nextMaxSessions)} sessions · ${parsePositiveInt(nextMaxBackgroundPollMs)} ms poll · ${formatBytes(parsePositiveInt(nextMaxBytes))} buffer`,
        onDone: (summary) => done(summary),
      });
    },
  };
}

function boolItem(
  id: string,
  label: string,
  description: string,
  scopedValue: boolean | undefined,
  resolvedValue: boolean,
): SettingItem {
  const display =
    scopedValue === undefined
      ? `inherited: ${resolvedValue ? "on" : "off"}`
      : scopedValue
        ? "on"
        : "off";
  return {
    id,
    label,
    description,
    currentValue: display,
    values: ["on", "off"],
  };
}

function positiveIntegerError(value: string): string | null {
  return Number.isInteger(Number(value)) && Number(value) > 0
    ? null
    : "Enter a positive integer";
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? 1 : parsed;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.round((bytes / (1024 * 1024)) * 100) / 100} MiB`;
  }
  if (bytes >= 1024) {
    return `${Math.round((bytes / 1024) * 100) / 100} KiB`;
  }
  return `${bytes} B`;
}
