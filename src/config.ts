/**
 * Configuration for the processes extension.
 *
 * Global: ~/.pi/agent/extensions/processes.json
 * Memory: ephemeral overrides via /process:settings
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";

export interface ProcessesConfig {
  processList?: {
    /** Max visible processes in the /process:list TUI list. */
    maxVisibleProcesses?: number;
    /** Max log preview lines shown below the selected process. */
    maxPreviewLines?: number;
  };
  output?: {
    /** Default number of tail lines returned to the agent. */
    defaultTailLines?: number;
    /** Hard cap on output lines returned to the agent. */
    maxOutputLines?: number;
  };
  execution?: {
    /** Absolute shell path override. Leave unset to auto-resolve. */
    shellPath?: string;
  };
  widget?: {
    /** Show the status widget below the editor. */
    showStatusWidget?: boolean;
  };
}

export interface ResolvedProcessesConfig {
  processList: {
    maxVisibleProcesses: number;
    maxPreviewLines: number;
  };
  output: {
    defaultTailLines: number;
    maxOutputLines: number;
  };
  execution: {
    shellPath?: string;
  };
  widget: {
    showStatusWidget: boolean;
  };
}

const DEFAULT_CONFIG: ResolvedProcessesConfig = {
  processList: {
    maxVisibleProcesses: 8,
    maxPreviewLines: 12,
  },
  output: {
    defaultTailLines: 100,
    maxOutputLines: 200,
  },
  execution: {},
  widget: {
    showStatusWidget: true,
  },
};

export const configLoader = new ConfigLoader<
  ProcessesConfig,
  ResolvedProcessesConfig
>("process", DEFAULT_CONFIG, {
  scopes: ["global", "memory"],
});
