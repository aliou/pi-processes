/**
 * Extension config types.
 *
 * User-facing schema is ProcessConfig (all fields optional).
 * Runtime config uses the shared protocol shape returned by REQUEST_CONFIG.
 */

import type { ProcessProtocolConfig } from "../../../src/protocol";

export interface ExecutionConfig {
  shellPath?: string;
}

export interface InterceptionConfig {
  blockBackgroundCommands?: boolean;
}

export interface ProcessListConfig {
  maxVisibleProcesses?: number;
  maxPreviewLines?: number;
}

export interface OutputConfig {
  defaultTailLines?: number;
  maxOutputLines?: number;
}

export interface FollowConfig {
  enabledByDefault?: boolean;
  autoHideOnFinish?: boolean;
}

export interface ProcessConfig {
  $schema?: string;
  execution?: ExecutionConfig;
  interception?: InterceptionConfig;
  processList?: ProcessListConfig;
  output?: OutputConfig;
  follow?: FollowConfig;
}

export type { ProcessProtocolConfig };
