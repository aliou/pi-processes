import type { SettingsSection } from "@aliou/pi-utils-settings";
import type { ProcessesConfig, ResolvedProcessesConfig } from "../../config";

export function buildSettingsSections(
  tabConfig: ProcessesConfig | null,
  resolved: ResolvedProcessesConfig,
): SettingsSection[] {
  return [
    {
      label: "Process List",
      items: [
        {
          id: "processList.maxVisibleProcesses",
          label: "Max visible processes",
          description:
            "Maximum processes shown in the /processes list before scrolling",
          currentValue: String(
            tabConfig?.processList?.maxVisibleProcesses ??
              resolved.processList.maxVisibleProcesses,
          ),
          values: ["4", "6", "8", "12", "16"],
        },
        {
          id: "processList.maxPreviewLines",
          label: "Max preview lines",
          description: "Log preview lines shown below the selected process",
          currentValue: String(
            tabConfig?.processList?.maxPreviewLines ??
              resolved.processList.maxPreviewLines,
          ),
          values: ["6", "8", "12", "16", "24"],
        },
      ],
    },
    {
      label: "Output Limits",
      items: [
        {
          id: "output.defaultTailLines",
          label: "Default tail lines",
          description: "Number of tail lines returned to the agent by default",
          currentValue: String(
            tabConfig?.output?.defaultTailLines ??
              resolved.output.defaultTailLines,
          ),
          values: ["50", "100", "200", "500"],
        },
        {
          id: "output.maxOutputLines",
          label: "Max output lines",
          description: "Hard cap on output lines returned to the agent",
          currentValue: String(
            tabConfig?.output?.maxOutputLines ?? resolved.output.maxOutputLines,
          ),
          values: ["100", "200", "500", "1000"],
        },
      ],
    },
    {
      label: "Execution",
      items: [
        {
          id: "execution.shellPath",
          label: "Shell path",
          description: "Absolute shell path override used to execute commands",
          currentValue:
            tabConfig?.execution?.shellPath ??
            resolved.execution.shellPath ??
            "auto",
          values: [
            "auto",
            "/run/current-system/sw/bin/bash",
            "/bin/bash",
            "/usr/bin/bash",
            "/usr/local/bin/bash",
          ],
        },
      ],
    },
    {
      label: "Interception",
      items: [
        {
          id: "interception.blockBackgroundCommands",
          label: "Block background commands",
          description:
            "Block bash background commands (&, nohup, disown, setsid) and guide the model to use the process tool",
          currentValue:
            (tabConfig?.interception?.blockBackgroundCommands ??
            resolved.interception.blockBackgroundCommands)
              ? "on"
              : "off",
          values: ["on", "off"],
        },
      ],
    },
    {
      label: "Widget",
      items: [
        {
          id: "widget.showStatusWidget",
          label: "Show status widget",
          description: "Show process status widget below the editor",
          currentValue:
            (tabConfig?.widget?.showStatusWidget ??
            resolved.widget.showStatusWidget)
              ? "on"
              : "off",
          values: ["on", "off"],
        },
        {
          id: "widget.dockDefaultState",
          label: "Dock default state",
          description:
            "Default visibility state of the log dock when follow mode is on",
          currentValue:
            tabConfig?.widget?.dockDefaultState ??
            resolved.widget.dockDefaultState,
          values: ["hidden", "collapsed"],
        },
        {
          id: "widget.dockHeight",
          label: "Dock height",
          description: "Height of the log dock in lines when open",
          currentValue: String(
            tabConfig?.widget?.dockHeight ?? resolved.widget.dockHeight,
          ),
          values: ["8", "10", "12", "16", "20"],
        },
      ],
    },
    {
      label: "Follow Mode",
      items: [
        {
          id: "follow.enabledByDefault",
          label: "Enable by default",
          description: "Automatically show logs when a process starts",
          currentValue:
            (tabConfig?.follow?.enabledByDefault ??
            resolved.follow.enabledByDefault)
              ? "on"
              : "off",
          values: ["on", "off"],
        },
        {
          id: "follow.autoHideOnFinish",
          label: "Auto-hide on finish",
          description: "Hide dock when all processes finish",
          currentValue:
            (tabConfig?.follow?.autoHideOnFinish ??
            resolved.follow.autoHideOnFinish)
              ? "on"
              : "off",
          values: ["on", "off"],
        },
      ],
    },
  ];
}
