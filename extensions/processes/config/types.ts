/**
 * Extension config types.
 *
 * User-facing schema is ProcessConfig (all fields optional).
 * Internal resolved schema is ResolvedProcessConfig (all fields required, defaults applied).
 */

export interface ExecutionConfig {
  shellPath?: string;
}

export interface InterceptionConfig {
  blockBackgroundCommands?: boolean;
}

export interface ProcessConfig {
  $schema?: string;
  execution?: ExecutionConfig;
  interception?: InterceptionConfig;
}

export interface ResolvedProcessConfig {
  execution: {
    shellPath: string | undefined;
  };
  interception: {
    blockBackgroundCommands: boolean;
  };
}
