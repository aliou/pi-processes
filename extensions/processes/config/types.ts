/**
 * Extension config types.
 *
 * User-facing schema is ProcessConfig (all fields optional).
 * Runtime config uses the shared protocol shape returned by REQUEST_CONFIG.
 */

import type { ProcessProtocolConfig } from "../../../src/protocol";
import type { CodexExecConfig } from "../../codex-unified-exec/config/types";

export interface ExecutionConfig {
  shellPath?: string;
}

export interface InterceptionConfig {
  blockBackgroundCommands?: boolean;
}

export interface ProcessListConfig {
  maxPreviewLines?: number;
  maxVisibleProcesses?: number;
}

export interface OutputConfig {
  defaultTailLines?: number;
  maxOutputLines?: number;
}

export interface FollowConfig {
  enabledByDefault?: boolean;
  autoHideOnFinish?: boolean;
}

export interface WidgetConfig {
  showStatusWidget?: boolean;
  dockDefaultState?: "closed" | "collapsed" | "expanded";
  dockHeight?: number;
}

export interface ProcessConfig {
  $schema?: string;
  execution?: ExecutionConfig;
  interception?: InterceptionConfig;
  processList?: ProcessListConfig;
  output?: OutputConfig;
  follow?: FollowConfig;
  widget?: WidgetConfig;
  /** codex-unified-exec gate; edited via /ps:settings. */
  codexExec?: CodexExecConfig;
}

export type { ProcessProtocolConfig };
