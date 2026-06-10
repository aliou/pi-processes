import type { ResolvedProcessConfig } from "./types";

export const DEFAULT_CONFIG: ResolvedProcessConfig = {
  execution: {
    shellPath: undefined,
  },
  interception: {
    blockBackgroundCommands: true,
  },
};
