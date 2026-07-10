import type { ProcessProtocolConfig } from "./types";

export const DEFAULT_CONFIG: ProcessProtocolConfig = {
  execution: {
    shellPath: undefined,
  },
  interception: {
    blockBackgroundCommands: false,
  },
  processList: {
    maxPreviewLines: 24,
    maxVisibleProcesses: 12,
  },
  output: {
    defaultTailLines: 100,
    maxOutputLines: 2000,
  },
  follow: {
    enabledByDefault: true,
    autoHideOnFinish: false,
  },
  widget: {
    showStatusWidget: false,
    dockDefaultState: "closed",
    dockHeight: 12,
  },
};
