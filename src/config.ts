/**
 * Configuration for the processes extension.
 *
 * Global: ~/.pi/agent/extensions/process.json
 * Memory: ephemeral overrides via /ps:settings
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";
import type { ProcessesKeybindings } from "./utils/keybindings";
import { DEFAULT_KEYBINDINGS } from "./utils/keybindings";

export interface ProcessesConfig {
  processList?: {
    /** Max visible processes in the /ps TUI list. */
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
  watch?: {
    /**
     * Default per-watch wake budget: after this many alert wakes, further
     * matches for that watch are suppressed and a single budget-reached notice
     * is sent. 0 = unlimited. Overridable per watch via LogWatch.maxWakes.
     */
    maxWakesPerWatch?: number;
    /** Suppress consecutive matches with an identical matched line by default. */
    dedupeConsecutive?: boolean;
  };
  stall?: {
    /**
     * Enable the silence-based stall detector. When a running process
     * produces no output for `silenceSeconds`, a steering wake alerts the
     * agent. Off by default (opt-in) to stay behavior-preserving.
     */
    enabled?: boolean;
    /**
     * Seconds of silence before a running process is considered stalled.
     * Only meaningful when `enabled` is true. Default 45.
     */
    silenceSeconds?: number;
  };
  retention?: {
    /**
     * How many finished (exited or killed) processes stay in the list. When a
     * process ends and more than this many are finished, the oldest finished
     * records are dropped automatically; their log files stay on disk so the
     * paths returned by `start` and `logs` remain readable. 0 keeps every
     * finished process until an explicit `clear`. Default 10.
     */
    maxFinished?: number;
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
  watch: {
    maxWakesPerWatch: number;
    dedupeConsecutive: boolean;
  };
  stall: {
    enabled: boolean;
    silenceSeconds: number;
  };
  retention: {
    maxFinished: number;
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
  watch: {
    maxWakesPerWatch: 20,
    dedupeConsecutive: false,
  },
  stall: {
    enabled: false,
    silenceSeconds: 45,
  },
  retention: {
    maxFinished: 10,
  },
};

export const configLoader = new ConfigLoader<
  ProcessesConfig,
  ResolvedProcessesConfig
>("process", DEFAULT_CONFIG, {
  scopes: ["global", "memory"],
});
