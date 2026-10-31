import { fileURLToPath } from "node:url";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { createPiCodingAgentHarness } from "./vendor/pi-evals/pi-harness";

/**
 * Absolute path to the processes extension entry point, loaded into the
 * isolated eval session via the patched `additionalExtensionPaths` option.
 */
export const processesExtensionPath = fileURLToPath(
  new URL("../../extensions/processes/index.ts", import.meta.url),
);

/** Absolute path to the shipped pi-processes skill. */
export const processesSkillPath = fileURLToPath(
  new URL("../../skills/pi-processes", import.meta.url),
);

/**
 * Tool-call arguments as plain JSON. The vendored harness constrains its
 * `output` to JsonValue, so everything here must stay JSON-safe.
 */
type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type ProcessToolCall = {
  name: string;
  arguments: JsonObject;
};

export type ProcessEvalResult = {
  action: "start" | "update";
  processId: string | null;
  pid: number | null;
  status: string | null;
  ok: boolean;
  watchPatterns: string[];
};

export type ProcessEvalOutput = {
  response: string;
  toolCalls: ProcessToolCall[];
  bashCommands: string[];
  activeTools: string[];
  successfulStarts: number;
  processResults: ProcessEvalResult[];
};

/**
 * Harness with the processes extension loaded and no skill, so evals measure
 * the tool description and promptGuidelines alone.
 */
export function createProcessesHarness(name = "processes-extension") {
  return createPiCodingAgentHarness({
    name,
    additionalExtensionPaths: [processesExtensionPath],
    output: ({ response, session }) => buildOutput(response, session),
  });
}

/**
 * Same as {@link createProcessesHarness} but with the pi-processes skill
 * available, for baseline/candidate comparisons of skill effectiveness.
 */
export function createProcessesHarnessWithSkill(
  name = "processes-extension-with-skill",
) {
  return createPiCodingAgentHarness({
    name,
    additionalExtensionPaths: [processesExtensionPath],
    additionalSkillPaths: [processesSkillPath],
    output: ({ response, session }) => buildOutput(response, session),
  });
}

export function buildOutput(
  response: string,
  session: Pick<AgentSession, "messages" | "getActiveToolNames">,
): ProcessEvalOutput {
  const processResults: ProcessEvalResult[] = [];
  for (const message of session.messages) {
    if (message.role !== "toolResult" || message.toolName !== "process")
      continue;
    const details = message.details as JsonObject | undefined;
    if (details?.action !== "start" && details?.action !== "update") continue;
    const process = isJsonObject(details.process) ? details.process : {};
    const notify = isJsonObject(details.notify) ? details.notify : {};
    const watches = isJsonObject(details.watches) ? details.watches : {};
    const items =
      details.action === "start" ? notify.logMatches : watches.items;
    processResults.push({
      action: details.action,
      processId: typeof process.id === "string" ? process.id : null,
      pid: typeof process.pid === "number" ? process.pid : null,
      status: typeof process.status === "string" ? process.status : null,
      ok:
        !message.isError && (details.action === "start" || details.ok === true),
      watchPatterns: Array.isArray(items)
        ? items.flatMap((item) =>
            isJsonObject(item) && typeof item.pattern === "string"
              ? [item.pattern]
              : [],
          )
        : [],
    });
  }
  return {
    response,
    toolCalls: toolCallsNamed(session, "process"),
    bashCommands: toolCallsNamed(session, "bash")
      .map((call) => call.arguments.command)
      .filter((command): command is string => typeof command === "string"),
    activeTools: session.getActiveToolNames(),
    successfulStarts: successfulStartResults(processResults).length,
    processResults,
  };
}

/** Every call to `toolName` in the session, in order. */
function toolCallsNamed(
  session: Pick<AgentSession, "messages">,
  toolName: string,
): ProcessToolCall[] {
  const calls: ProcessToolCall[] = [];
  for (const message of session.messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "toolCall" || part.name !== toolName) continue;
      calls.push({
        name: part.name,
        arguments: (part.arguments ?? {}) as JsonObject,
      });
    }
  }
  return calls;
}

/** `process` calls narrowed to a single action. */
export function callsWithAction(
  calls: ProcessToolCall[],
  action: string,
): ProcessToolCall[] {
  return calls.filter((call) => call.arguments.action === action);
}

/** True when a `process` call declares at least one log watch. */
export function hasLogMatchWatch(call: ProcessToolCall): boolean {
  const notify = call.arguments.notify;
  if (isJsonObject(notify) && Array.isArray(notify.logMatches)) {
    return notify.logMatches.length > 0;
  }
  const watches = call.arguments.watches;
  if (isJsonObject(watches) && Array.isArray(watches.items)) {
    return watches.items.length > 0;
  }
  return false;
}

function successfulStartResults(
  results: ProcessEvalResult[],
): ProcessEvalResult[] {
  return results.filter(
    (result) =>
      result.action === "start" &&
      result.ok &&
      result.processId !== null &&
      result.pid !== null &&
      Number.isInteger(result.pid) &&
      result.pid > 0 &&
      result.status === "running",
  );
}

export function watchPatternsForStartedProcess(
  results: ProcessEvalResult[],
  updatesOnly = false,
): string[] {
  const starts = successfulStartResults(results);
  return results.flatMap((result) =>
    result.ok &&
    starts.some((start) => start.processId === result.processId) &&
    (result.action === "update" || (!updatesOnly && starts.includes(result)))
      ? result.watchPatterns
      : [],
  );
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
