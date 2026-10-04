import type { Context } from "@earendil-works/chord";
import {
  defineTool,
  type JsonObject,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { LIVE_STATUSES, type ProcessInfo } from "../src/types";
import { stripAnsi } from "../src/utils/ansi";
import { compileLineMatcher } from "../src/utils/match-line";
import type { createProcessTask } from "./process-task";
import type { ProcessRuntime } from "./runtime";
import { ProcessParams, required } from "./schema";
import { compileWatches } from "./watches";

function result(details: JsonObject) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details) }],
    details,
  };
}

function snapshot(info: ProcessInfo) {
  return {
    ...info,
    name: info.name.slice(0, 256),
    command: info.command.slice(0, 512),
    cwd: info.cwd.slice(0, 512),
    errorMessage: info.errorMessage?.slice(0, 1000) ?? null,
  };
}

function bounded<T>(
  items: T[],
  maxBytes: number,
  tail = false,
): { items: T[]; truncated: boolean } {
  const kept: T[] = [];
  let bytes = 2;
  const ordered = tail ? [...items].reverse() : items;
  for (const item of ordered) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes + size > maxBytes) break;
    kept.push(item);
    bytes += size;
  }
  if (tail) kept.reverse();
  return { items: kept, truncated: kept.length !== items.length };
}

function filterStatus(
  info: ProcessInfo,
  statuses: NonNullable<ProcessParams["statuses"]>,
): boolean {
  if (statuses.length === 0 || statuses.includes("all")) return true;
  if (statuses.includes(info.status)) return true;
  if (statuses.includes("finished") && !LIVE_STATUSES.has(info.status))
    return true;
  return statuses.includes("failed") && info.success === false;
}

function list(processes: ProcessRuntime, params: ProcessParams) {
  const infos = processes.manager
    .list()
    .filter((info) => filterStatus(info, params.statuses ?? []));
  const sort = params.sortBy ?? "startTime_desc";
  if (sort.startsWith("startTime"))
    infos.sort((a, b) => a.startTime - b.startTime);
  else
    infos.sort((a, b) =>
      sort === "status_asc"
        ? a.status.localeCompare(b.status)
        : a.name.localeCompare(b.name),
    );
  if (sort.endsWith("desc")) infos.reverse();
  const limited = infos.slice(0, params.limit ?? 20);
  const selected = bounded(
    limited.map((info) => ({
      ...snapshot(info),
      taskId: processes.tracking(info.id)?.taskId ?? null,
    })),
    64 * 1024,
  );
  return result({
    action: "list",
    processes: selected.items,
    total: infos.length,
    truncated: selected.items.length < infos.length,
  });
}

function output(processes: ProcessRuntime, params: ProcessParams) {
  const id = required(params.id, "id");
  const info = processes.manager.get(id);
  if (!info) throw new Error(`Unknown process: ${id}`);
  const matcher = params.pattern
    ? compileLineMatcher(params.pattern, params.mode ?? "literal")
    : null;
  const tail = params.tailLines ?? 100;
  const raw = processes.manager.getOutput(id, matcher ? 5000 : tail);
  if (!raw) throw new Error(`Output unavailable: ${id}`);
  const select = (lines: string[]) =>
    lines
      .filter((line) => !matcher || (line.length <= 10_000 && matcher(line)))
      .slice(-tail);
  const stdout = params.stream === "stderr" ? [] : select(raw.stdout);
  const stderr = params.stream === "stdout" ? [] : select(raw.stderr);
  const out = bounded(stdout, 20 * 1024, true);
  const err = bounded(stderr, 20 * 1024, true);
  return {
    content: [
      {
        type: "text" as const,
        text: stripAnsi(
          `stdout:\n${stdout.join("\n")}\nstderr:\n${stderr.join("\n")}`,
        ),
      },
    ],
    details: {
      action: "output",
      id,
      status: info.status,
      stdout: out.items,
      stderr: err.items,
      stdoutFile: info.stdoutFile,
      stderrFile: info.stderrFile,
      truncated: out.truncated || err.truncated,
    },
    diagnostics: [
      {
        severity: "info" as const,
        code: "log_files",
        message: `Full output: ${info.stdoutFile}; ${info.stderrFile}`,
      },
    ],
  };
}

async function start(
  processes: ProcessRuntime,
  ProcessTask: ReturnType<typeof createProcessTask>,
  params: ProcessParams,
  api: ToolExecutionApi,
  context: Context,
) {
  const name = required(params.name, "name");
  const command = required(params.command, "command");
  const notify = params.notify ?? {};
  compileWatches(notify.logMatches ?? []);
  const agent = await api.agent(context);
  const cwd =
    params.cwd ??
    api.env?.cwd ??
    agent.cwd ??
    processes.options.cwd ??
    process.cwd();
  const taskId = await api.createTask(
    ProcessTask,
    {
      conversationId: api.conversationId,
      runtimeId: processes.id,
      name,
      command,
      cwd,
      notify,
    },
    { ownership: { kind: "conversation" }, background: true },
    context,
  );
  return result({
    action: "start",
    taskId,
    conversationId: api.conversationId,
  });
}

function write(processes: ProcessRuntime, params: ProcessParams) {
  const id = required(params.id, "id");
  if (params.input === undefined && !params.end)
    throw new Error("process write requires input or end");
  const written = processes.manager.writeToStdin(id, params.input ?? "", {
    end: params.end,
  });
  return result({
    action: "write",
    id,
    ...written,
    bytes: written.ok ? Buffer.byteLength(params.input ?? "") : 0,
    end: params.end ?? false,
  });
}

async function stop(processes: ProcessRuntime, params: ProcessParams) {
  const ids = params.all
    ? processes.manager
        .list()
        .filter((info) => LIVE_STATUSES.has(info.status))
        .map((info) => info.id)
    : [required(params.id, "id")];
  const stopped = await Promise.all(
    ids.map((id) =>
      processes.stop(id, {
        signal: params.signal,
        timeoutMs: params.timeoutMs,
      }),
    ),
  );
  const results = bounded(
    stopped.map((item) => ({ ...item, info: snapshot(item.info) })),
    64 * 1024,
  );
  return result({
    action: "stop",
    results: results.items,
    truncated: results.truncated,
  });
}

function update(processes: ProcessRuntime, params: ProcessParams) {
  const id = required(params.id, "id");
  if (!processes.manager.get(id)) throw new Error(`Unknown process: ${id}`);
  if (!params.name && !params.watches)
    throw new Error("process update requires name or watches");
  if (params.watches) processes.updateWatches(id, params.watches);
  if (params.name) processes.manager.rename(id, params.name);
  return result({
    action: "update",
    id,
    name: processes.manager.get(id)?.name ?? null,
    watches: processes.tracking(id)?.watches.map((watch) => watch.config) ?? [],
  });
}

type ActionHandler = (
  params: ProcessParams,
  api: ToolExecutionApi,
  context: Context,
) => ToolExecutionResult | Promise<ToolExecutionResult>;

export function createProcessTool(
  processes: ProcessRuntime,
  ProcessTask: ReturnType<typeof createProcessTask>,
): ToolRegistration<typeof ProcessParams> {
  const handlers: Record<ProcessParams["action"], ActionHandler> = {
    start: (params, api, context) =>
      start(processes, ProcessTask, params, api, context),
    list: (params) => list(processes, params),
    output: (params) => output(processes, params),
    write: (params) => write(processes, params),
    stop: (params) => stop(processes, params),
    update: (params) => update(processes, params),
    clear: () =>
      result({ action: "clear", cleared: processes.manager.clearFinished() }),
  };
  return defineTool({
    name: "process",
    description:
      "Manage local background processes. Start creates a background lifecycle task and returns its task ID; list shows process IDs and task IDs. Inspect output, write stdin, update log watches, stop, or clear finished processes.",
    parameters: ProcessParams,
    replay: "unsafe",
    outputLimits: { maxBytes: 50 * 1024, maxLines: 2000, retain: "tail" },
    async execute(params, api, context) {
      if (processes.closed) throw new Error("Process extension is disposed");
      if (api.env && api.env.id !== "node:local")
        throw new Error("process requires a local Node execution environment");
      return handlers[params.action](params, api, context);
    },
  });
}
