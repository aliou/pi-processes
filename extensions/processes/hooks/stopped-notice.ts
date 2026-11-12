import type {
  CustomEntry,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

import { MESSAGE_TYPE_PROCESSES_STOPPED } from "../constants";

const ProcessesStoppedDataSchema = Type.Object({
  processes: Type.Array(
    Type.Object({
      name: Type.String(),
      command: Type.String(),
    }),
  ),
});

export type StoppedProcessRecord = Static<
  typeof ProcessesStoppedDataSchema
>["processes"][number];

export type ProcessesStoppedDetails = Static<typeof ProcessesStoppedDataSchema>;

export function appendStoppedProcessesEntry(
  pi: ExtensionAPI,
  processes: StoppedProcessRecord[],
): void {
  try {
    pi.appendEntry(MESSAGE_TYPE_PROCESSES_STOPPED, { processes });
  } catch {
    return;
  }
}

export function registerStoppedNoticeHook(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const entry = findUnconsumedStoppedEntry(ctx);
    if (!entry) return;

    const details = parseStoppedProcesses(entry.data);
    if (details.processes.length === 0) return;

    pi.sendMessage<ProcessesStoppedDetails>(
      {
        customType: MESSAGE_TYPE_PROCESSES_STOPPED,
        content: summary(details.processes.length),
        display: true,
        details,
      },
      { triggerTurn: false },
    );
  });
}

function summary(count: number): string {
  const noun = count === 1 ? "process" : "processes";
  return `[processes] ${count} background ${noun} stopped when the previous session ended.`;
}

function parseStoppedProcesses(data: unknown): ProcessesStoppedDetails {
  if (Value.Check(ProcessesStoppedDataSchema, data)) {
    return data;
  }
  return { processes: [] };
}

function findUnconsumedStoppedEntry(
  ctx: ExtensionContext,
): CustomEntry | undefined {
  let stopped: CustomEntry | undefined;
  let consumed = false;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (
      entry.type === "custom" &&
      entry.customType === MESSAGE_TYPE_PROCESSES_STOPPED
    ) {
      stopped = entry;
      consumed = false;
    } else if (
      stopped &&
      entry.type === "custom_message" &&
      entry.customType === MESSAGE_TYPE_PROCESSES_STOPPED
    ) {
      consumed = true;
    }
  }

  return stopped && !consumed ? stopped : undefined;
}
