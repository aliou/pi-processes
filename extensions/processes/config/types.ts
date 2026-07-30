/**
 * Extension config types.
 *
 * User-facing schema is ProcessConfig (all fields optional).
 * Runtime config uses the shared protocol shape returned by REQUEST_CONFIG.
 */

import type { ProcessProtocolConfig } from "../../../src/protocol";

export interface ExecutionConfig {
  /** Absolute shell executable used to run process commands. */
  shellPath?: string;
}

export interface InterceptionConfig {
  /** Block shell background patterns and redirect the agent to the process tool. */
  blockBackgroundCommands?: boolean;
}

export interface ProcessListConfig {
  /** Maximum log rows displayed in the overview preview and logs overlay. */
  maxPreviewLines?: number;
  /** Maximum process rows displayed in the overview before scrolling. */
  maxVisibleProcesses?: number;
}

export interface OutputConfig {
  /** Default number of recent lines returned by the process output action. */
  defaultTailLines?: number;
  /** Maximum lines retained by process log interfaces. */
  maxOutputLines?: number;
  /** Maximum bytes retained by each process log interface. */
  maxOutputBytes?: number;
}

export interface FollowConfig {
  /** Open process log interfaces in follow mode by default. */
  enabledByDefault?: boolean;
  /** Hide process log interfaces when all managed processes finish. */
  autoHideOnFinish?: boolean;
}

export interface WidgetConfig {
  /** Show a one-line process summary below the editor. */
  showStatusWidget?: boolean;
  /** Initial visibility of the process dock. */
  dockDefaultState?: "closed" | "collapsed" | "expanded";
  /** Number of log rows displayed in the expanded process dock. */
  dockHeight?: number;
}

/** User-facing pi-processes settings stored on disk. */
export interface ProcessConfig {
  /** JSON Schema URL used by editors for validation and autocomplete. */
  $schema?: string;
  /** Config migration marker written after v0.10.0 settings migration. */
  version?: string;
  /** Process execution settings. */
  execution?: ExecutionConfig;
  /** Shell-command interception settings. */
  interception?: InterceptionConfig;
  /** Process overview and log viewport settings. */
  processList?: ProcessListConfig;
  /** Process output retention settings. */
  output?: OutputConfig;
  /** Live log follow behavior. */
  follow?: FollowConfig;
  /** Dock and status widget settings. */
  widget?: WidgetConfig;
}

export type { ProcessProtocolConfig };
