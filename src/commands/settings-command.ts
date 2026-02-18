import {
  registerSettingsCommand,
  type SettingsSection,
} from "@aliou/pi-utils-settings";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ProcessesConfig, ResolvedProcessesConfig } from "../config";
import { configLoader } from "../config";

export function registerProcessesSettings(
  pi: ExtensionAPI,
  onSave?: () => void,
): void {
  registerSettingsCommand<ProcessesConfig, ResolvedProcessesConfig>(pi, {
    commandName: "process:settings",
    title: "Processes Settings",
    configStore: configLoader,
    buildSections: (
      tabConfig: ProcessesConfig | null,
      resolved: ResolvedProcessesConfig,
    ): SettingsSection[] => {
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
              description:
                "Number of tail lines returned to the agent by default",
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
                tabConfig?.output?.maxOutputLines ??
                  resolved.output.maxOutputLines,
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
              description:
                "Absolute shell path override used to execute commands",
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
          ],
        },
      ];
    },
    onSettingChange: (id, newValue, config) => {
      const updated = structuredClone(config);
      // Boolean fields.
      if (id === "widget.showStatusWidget") {
        if (!updated.widget) updated.widget = {};
        updated.widget.showStatusWidget = newValue === "on";
        return updated;
      }
      if (id === "execution.shellPath") {
        if (!updated.execution) updated.execution = {};
        updated.execution.shellPath =
          newValue === "auto" ? undefined : newValue;
        return updated;
      }

      // Numeric fields.
      const num = Number.parseInt(newValue, 10);
      if (Number.isNaN(num)) return null;

      switch (id) {
        case "processList.maxVisibleProcesses":
          if (!updated.processList) updated.processList = {};
          updated.processList.maxVisibleProcesses = num;
          break;
        case "processList.maxPreviewLines":
          if (!updated.processList) updated.processList = {};
          updated.processList.maxPreviewLines = num;
          break;
        case "output.defaultTailLines":
          if (!updated.output) updated.output = {};
          updated.output.defaultTailLines = num;
          break;
        case "output.maxOutputLines":
          if (!updated.output) updated.output = {};
          updated.output.maxOutputLines = num;
          break;
        default:
          return null;
      }
      return updated;
    },
    onSave,
  });
}
