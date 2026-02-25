/**
 * Configuration for the processes extension.
 *
 * Global: ~/.pi/agent/extensions/processes.json
 * Memory: ephemeral overrides via /process:settings
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";
import type { ProcessesKeybindings } from "./utils/keybindings";
import { DEFAULT_KEYBINDINGS } from "./utils/keybindings";

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
    /** Default dock state when follow mode is enabled. */
    dockDefaultState?: "hidden" | "collapsed";
    /** Height of the dock in lines when open. */
    dockHeight?: number;
  };
  follow?: {
    /** Enable follow mode by default when starting processes. */
    enabledByDefault?: boolean;
    /** Auto-hide dock when all processes finish. */
    autoHideOnFinish?: boolean;
  };
  keybindings?: Partial<ProcessesKeybindings>;
  interception?: {
    /** Block background bash commands (&, nohup, disown, setsid) and guide the model to use the process tool. */
    blockBackgroundCommands?: boolean;
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
    dockDefaultState: "hidden" | "collapsed";
    dockHeight: number;
  };
  follow: {
    enabledByDefault: boolean;
    autoHideOnFinish: boolean;
  };
  keybindings: ProcessesKeybindings;
  interception: {
    blockBackgroundCommands: boolean;
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
    showStatusWidget: false,
    dockDefaultState: "collapsed",
    dockHeight: 12,
  },
  follow: {
    enabledByDefault: true,
    autoHideOnFinish: true,
  },
  keybindings: DEFAULT_KEYBINDINGS,
  interception: {
    blockBackgroundCommands: false,
  },
};

export const configLoader = new ConfigLoader<
  ProcessesConfig,
  ResolvedProcessesConfig
>("process", DEFAULT_CONFIG, {
  scopes: ["global", "memory"],
});
