import type { ProcessInfo } from "../../../src/types";

// Core emits, UI listens.

export type ProcessesStartedPayload = ProcessInfo;
export type ProcessesEndedPayload = ProcessInfo;
export type ProcessesOutputChangedPayload = {
  id: string;
  appendedText?: Array<{ type: "stdout" | "stderr"; text: string }>;
  droppedLines?: number;
};
export type ProcessesHoldStartedPayload = {
  id: string;
  name: string;
  command: string;
};
export type ProcessesHoldEndedPayload = {
  id: string;
  success: boolean;
};
export type ProcessesChangedPayload = {
  reason: "started" | "ended" | "cleared";
};
