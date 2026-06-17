import type { ProcessProtocolConfig } from "./types";

export const DEFAULT_CONFIG: ProcessProtocolConfig = {
  execution: {
    shellPath: undefined,
  },
  interception: {
    blockBackgroundCommands: true,
  },
  processList: {
    maxPreviewLines: 24,
  },
  output: {
    defaultTailLines: 100,
    maxOutputLines: 2000,
  },
  follow: {
    enabledByDefault: true,
    autoHideOnFinish: false,
  },
};
