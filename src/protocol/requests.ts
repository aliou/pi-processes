import type { ProcessInfo } from "../types";

// UI emits, core listens and calls reply synchronously.
// Reply callbacks make this an in-process protocol, not serializable IPC/RPC.

export interface RequestListPayload {
  reply: (processes: ProcessInfo[]) => void;
}

export interface RequestGetPayload {
  id: string;
  reply: (info: ProcessInfo | null) => void;
}

export interface RequestOutputPayload {
  id: string;
  tailLines?: number;
  reply: (
    output: { stdout: string[]; stderr: string[]; status: string } | null,
  ) => void;
}

export interface RequestCombinedOutputPayload {
  id: string;
  tailLines?: number;
  reply: (
    lines: Array<{ type: "stdout" | "stderr"; text: string }> | null,
  ) => void;
}

export interface RequestLogFilesPayload {
  id: string;
  reply: (
    files: {
      stdoutFile: string;
      stderrFile: string;
      combinedFile: string;
    } | null,
  ) => void;
}

export interface RequestFileSizePayload {
  id: string;
  reply: (sizes: { stdout: number; stderr: number } | null) => void;
}

export interface ProcessProtocolConfig {
  execution: {
    shellPath: string | undefined;
  };
  interception: {
    blockBackgroundCommands: boolean;
  };
  processList: {
    maxPreviewLines: number;
  };
  output: {
    defaultTailLines: number;
    maxOutputLines: number;
  };
  follow: {
    enabledByDefault: boolean;
    autoHideOnFinish: boolean;
  };
  widget: {
    dockDefaultState: "closed" | "collapsed" | "expanded";
    dockHeight: number;
  };
}

export interface RequestConfigPayload {
  reply: (config: ProcessProtocolConfig) => void;
}
