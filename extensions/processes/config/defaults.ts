import type { ProcessProtocolConfig } from "./types";

export const DEFAULT_CONFIG: ProcessProtocolConfig = {
  execution: {
    shellPath: undefined,
  },
  interception: {
    blockBackgroundCommands: false,
  },
  processList: {
    maxPreviewLines: 12,
    maxVisibleProcesses: 8,
  },
  output: {
    defaultTailLines: 100,
    maxOutputLines: 200,
    maxOutputBytes: 4 * 1024 * 1024,
  },
  follow: {
    enabledByDefault: true,
    autoHideOnFinish: true,
  },
  widget: {
    showStatusWidget: false,
    dockDefaultState: "closed",
    dockHeight: 12,
  },
  codexExec: {
    enabled: false,
  },
};
