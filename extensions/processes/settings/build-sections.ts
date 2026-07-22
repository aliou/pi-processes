/**
 * Build settings sections for the processes package.
 *
 * The first-level view stays focused. Extension-specific groups open focused
 * detail panels instead of expanding every setting into one long list.
 */

import {
  type Scope,
  SettingsDetailEditor,
  type SettingsSection,
  type SettingsTheme,
} from "@aliou/pi-utils-settings";
import type { SettingItem } from "@earendil-works/pi-tui";

import type { ProcessConfig, ProcessProtocolConfig } from "../config";

interface BuildSectionsContext {
  setDraft: (config: ProcessConfig) => void;
  scope: Scope;
  isInherited: (path: string) => boolean;
  theme: SettingsTheme;
}

export function buildSections(
  tabConfig: ProcessConfig | null,
  resolved: ProcessProtocolConfig,
  ctx: BuildSectionsContext,
): SettingsSection[] {
  const scopedConfig = structuredClone(tabConfig ?? {}) as ProcessConfig;

  const coreSection: SettingsSection = {
    label: "Core",
    items: [
      buildShellPathItem(scopedConfig, resolved, ctx),
      boolItem(
        "interception.blockBackgroundCommands",
        "Block background commands",
        "Block shell background patterns (&, nohup, disown, setsid) in bash tool calls. Redirects to the process tool instead.",
        scopedConfig.interception?.blockBackgroundCommands,
        resolved.interception.blockBackgroundCommands,
      ),
      boolItem(
        "codexExec.enabled",
        "Codex unified exec",
        "Expose the codex unified_exec tools (exec_command, write_stdin) that emulate OpenAI Codex's interactive session model over pi-processes. Disabled by default.",
        scopedConfig.codexExec?.enabled,
        resolved.codexExec.enabled,
      ),
    ],
  };

  const logsSection: SettingsSection = {
    label: "Interfaces",
    items: [
      boolItem(
        "widget.showStatusWidget",
        "Status widget",
        "Show a one-line summary of managed processes below the editor.",
        scopedConfig.widget?.showStatusWidget,
        resolved.widget.showStatusWidget,
      ),
      buildOverviewDetailItem(scopedConfig, resolved, ctx),
      buildLogsDetailItem(scopedConfig, resolved, ctx),
      buildDockDetailItem(scopedConfig, resolved, ctx),
    ],
  };

  return [coreSection, logsSection];
}

function buildShellPathItem(
  scopedConfig: ProcessConfig,
  resolved: ProcessProtocolConfig,
  ctx: BuildSectionsContext,
): SettingItem {
  const shellPath =
    scopedConfig.execution?.shellPath ?? resolved.execution.shellPath ?? "";
  const display = scopedConfig.execution?.shellPath
    ? scopedConfig.execution.shellPath
    : resolved.execution.shellPath
      ? `inherited: ${resolved.execution.shellPath}`
      : "(default)";

  return {
    id: "execution.shellPath.details",
    label: "Shell path",
    currentValue: display,
    description:
      "Open focused settings for the shell executable used by process commands.",
    submenu: (_current, done) => {
      const current = scopedConfig;
      let nextShellPath = shellPath;

      const syncDraft = () => {
        ctx.setDraft({
          ...current,
          execution: {
            ...current.execution,
            shellPath: nextShellPath,
          },
        });
      };

      return new SettingsDetailEditor({
        title: "Shell path",
        theme: ctx.theme,
        fields: [
          {
            id: "execution.shellPath.value",
            type: "text",
            label: "Shell path",
            description:
              "Path to the shell executable. Leave empty to use the system default.",
            getValue: () => nextShellPath,
            setValue: (value) => {
              nextShellPath = value;
              syncDraft();
            },
            displayValue: (value) => value || "(default)",
          },
        ],
        getDoneSummary: () => nextShellPath || "(default)",
        onDone: (summary) => done(summary),
      });
    },
  };
}

function buildOverviewDetailItem(
  scopedConfig: ProcessConfig,
  resolved: ProcessProtocolConfig,
  ctx: BuildSectionsContext,
): SettingItem {
  const maxVisibleProcesses =
    scopedConfig.processList?.maxVisibleProcesses ??
    resolved.processList.maxVisibleProcesses;

  return {
    id: "overview.details",
    label: "Overview panel",
    currentValue: `${maxVisibleProcesses} rows`,
    description:
      "Open focused settings for the /ps overview panel visible row count.",
    submenu: (_current, done) => {
      const current = scopedConfig;
      let nextMaxVisible = String(maxVisibleProcesses);

      const syncDraft = () => {
        const updated: ProcessConfig = {
          ...current,
          processList: {
            ...current.processList,
            maxVisibleProcesses: parsePositiveInt(nextMaxVisible),
          },
        };
        ctx.setDraft(updated);
      };

      return new SettingsDetailEditor({
        title: "Overview panel",
        theme: ctx.theme,
        fields: [
          {
            id: "overview.maxVisibleProcesses",
            type: "text",
            label: "Visible rows",
            description:
              "Maximum process rows shown at once in the /ps overview. The list scrolls past this.",
            getValue: () => nextMaxVisible,
            setValue: (value) => {
              nextMaxVisible = value;
              syncDraft();
            },
            validate: positiveIntegerError,
          },
        ],
        getDoneSummary: () => `${parsePositiveInt(nextMaxVisible)} rows`,
        onDone: (summary) => done(summary),
      });
    },
  };
}

function buildLogsDetailItem(
  scopedConfig: ProcessConfig,
  resolved: ProcessProtocolConfig,
  ctx: BuildSectionsContext,
): SettingItem {
  const viewportRows =
    scopedConfig.processList?.maxPreviewLines ??
    resolved.processList.maxPreviewLines;
  const historyLines =
    scopedConfig.output?.maxOutputLines ?? resolved.output.maxOutputLines;
  const followByDefault =
    scopedConfig.follow?.enabledByDefault ?? resolved.follow.enabledByDefault;

  return {
    id: "logs.details",
    label: "Logs overlay",
    currentValue: `${historyLines} lines · ${viewportRows} rows · ${followByDefault ? "follow" : "manual"}`,
    description:
      "Open focused settings for /ps:logs tabs, history, viewport, and follow behavior.",
    submenu: (_current, done) => {
      const current = scopedConfig;
      let nextViewportRows = String(viewportRows);
      let nextHistoryLines = String(historyLines);
      let nextFollowByDefault = followByDefault;
      let nextAutoHideOnFinish =
        scopedConfig.follow?.autoHideOnFinish ??
        resolved.follow.autoHideOnFinish;

      const syncDraft = () => {
        const updated: ProcessConfig = {
          ...current,
          processList: {
            ...current.processList,
            maxPreviewLines: parsePositiveInt(nextViewportRows),
          },
          output: {
            ...current.output,
            maxOutputLines: parsePositiveInt(nextHistoryLines),
          },
          follow: {
            ...current.follow,
            enabledByDefault: nextFollowByDefault,
            autoHideOnFinish: nextAutoHideOnFinish,
          },
        };
        ctx.setDraft(updated);
      };

      return new SettingsDetailEditor({
        title: "Logs overlay",
        theme: ctx.theme,
        fields: [
          {
            id: "logs.viewportRows",
            type: "text",
            label: "Viewport rows",
            description:
              "Maximum log rows rendered in the /ps:logs overlay body.",
            getValue: () => nextViewportRows,
            setValue: (value) => {
              nextViewportRows = value;
              syncDraft();
            },
            validate: positiveIntegerError,
          },
          {
            id: "logs.historyLines",
            type: "text",
            label: "History lines",
            description:
              "Maximum existing log lines loaded when opening a process log.",
            getValue: () => nextHistoryLines,
            setValue: (value) => {
              nextHistoryLines = value;
              syncDraft();
            },
            validate: positiveIntegerError,
          },
          {
            id: "logs.followByDefault",
            type: "boolean",
            label: "Follow by default",
            description: "Open process logs pinned to the latest output.",
            getValue: () => nextFollowByDefault,
            setValue: (value) => {
              nextFollowByDefault = value;
              syncDraft();
            },
          },
          {
            id: "logs.autoHideOnFinish",
            type: "boolean",
            label: "Auto-hide on finish",
            description:
              "Close the logs overlay when all processes have finished.",
            getValue: () => nextAutoHideOnFinish,
            setValue: (value) => {
              nextAutoHideOnFinish = value;
              syncDraft();
            },
          },
        ],
        getDoneSummary: () =>
          `${parsePositiveInt(nextHistoryLines)} lines · ${parsePositiveInt(nextViewportRows)} rows · ${nextFollowByDefault ? "follow" : "manual"}`,
        onDone: (summary) => done(summary),
      });
    },
  };
}

function buildDockDetailItem(
  scopedConfig: ProcessConfig,
  resolved: ProcessProtocolConfig,
  ctx: BuildSectionsContext,
): SettingItem {
  const dockDefaultState =
    scopedConfig.widget?.dockDefaultState ?? resolved.widget.dockDefaultState;
  const dockHeight =
    scopedConfig.widget?.dockHeight ?? resolved.widget.dockHeight;

  return {
    id: "dock.details",
    label: "Dock",
    currentValue: `${dockDefaultState} · ${dockHeight} log lines`,
    description:
      "Open focused settings for the /ps:dock widget above the editor.",
    submenu: (_current, done) => {
      const current = scopedConfig;
      let nextDockDefaultState = dockDefaultState;
      let nextDockHeight = String(dockHeight);

      const syncDraft = () => {
        ctx.setDraft({
          ...current,
          widget: {
            ...current.widget,
            dockDefaultState: nextDockDefaultState,
            dockHeight: parsePositiveInt(nextDockHeight),
          },
        });
      };

      return new SettingsDetailEditor({
        title: "Dock",
        theme: ctx.theme,
        fields: [
          {
            id: "dock.defaultState",
            type: "enum",
            label: "Default state",
            description: "Initial state, also used when a new process starts.",
            options: ["closed", "collapsed", "expanded"],
            getValue: () => nextDockDefaultState,
            setValue: (value) => {
              nextDockDefaultState = value as
                | "closed"
                | "collapsed"
                | "expanded";
              syncDraft();
            },
          },
          {
            id: "dock.height",
            type: "text",
            label: "Log lines displayed",
            description:
              "Maximum log/content rows shown inside the dock. Border, title, process strip, and separator are added on top.",
            getValue: () => nextDockHeight,
            setValue: (value) => {
              nextDockHeight = value;
              syncDraft();
            },
            validate: positiveIntegerError,
          },
        ],
        getDoneSummary: () =>
          `${nextDockDefaultState} · ${parsePositiveInt(nextDockHeight)} log lines`,
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
