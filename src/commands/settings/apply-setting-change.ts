import type { ProcessesConfig } from "../../config";

export function applySettingChange(
  id: string,
  newValue: string,
  config: ProcessesConfig,
): ProcessesConfig | null {
  const updated = structuredClone(config);

  if (id === "interception.blockBackgroundCommands") {
    if (!updated.interception) updated.interception = {};
    updated.interception.blockBackgroundCommands = newValue === "on";
    return updated;
  }
  if (id === "widget.showStatusWidget") {
    if (!updated.widget) updated.widget = {};
    updated.widget.showStatusWidget = newValue === "on";
    return updated;
  }
  if (id === "widget.dockDefaultState") {
    if (!updated.widget) updated.widget = {};
    updated.widget.dockDefaultState =
      newValue === "hidden" ? "hidden" : "collapsed";
    return updated;
  }
  if (id === "widget.dockHeight") {
    if (!updated.widget) updated.widget = {};
    updated.widget.dockHeight = Number.parseInt(newValue, 10);
    return updated;
  }
  if (id === "follow.enabledByDefault") {
    if (!updated.follow) updated.follow = {};
    updated.follow.enabledByDefault = newValue === "on";
    return updated;
  }
  if (id === "follow.autoHideOnFinish") {
    if (!updated.follow) updated.follow = {};
    updated.follow.autoHideOnFinish = newValue === "on";
    return updated;
  }
  if (id === "execution.shellPath") {
    if (!updated.execution) updated.execution = {};
    updated.execution.shellPath = newValue === "auto" ? undefined : newValue;
    return updated;
  }

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
}
