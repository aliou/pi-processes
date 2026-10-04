import {
  type ConversationId,
  defineTask,
  type Task,
} from "@earendil-works/pi-durable";
import type { ProcessInfo } from "../src/types";
import type { ProcessRuntime } from "./runtime";
import type { NotifyConfig } from "./schema";
import { compileWatches } from "./watches";

export interface ProcessTaskInput {
  conversationId: ConversationId;
  runtimeId: string;
  name: string;
  command: string;
  cwd: string;
  notify: NotifyConfig;
}

export type ProcessTaskState =
  | { phase: "spawn" }
  | {
      phase: "observe";
      processId: string | null;
      stdoutFile: string | null;
      stderrFile: string | null;
    };

export type ProcessTaskResult =
  | { status: "ended"; process: ProcessInfo }
  | {
      status: "lost";
      reason: "manager_state_lost" | "spawn_outcome_unknown";
      processId: string | null;
    };

function observing(
  info?: ProcessInfo,
): Extract<ProcessTaskState, { phase: "observe" }> {
  return {
    phase: "observe",
    processId: info?.id ?? null,
    stdoutFile: info?.stdoutFile ?? null,
    stderrFile: info?.stderrFile ?? null,
  };
}

export function createProcessTask(
  processes: ProcessRuntime,
): Task<ProcessTaskInput, ProcessTaskState, ProcessTaskResult, object> {
  return defineTask<ProcessTaskInput, ProcessTaskState, ProcessTaskResult>({
    name: "pi-processes.process",
    version: 1,
    initial: () => ({ phase: "spawn" }),
    phases: {
      async spawn(task, runtime, context) {
        const watches = compileWatches(task.input.notify.logMatches ?? []);
        // Record the attempt before spawning. Recovery must not repeat an uncertain OS effect.
        await runtime.commit(
          () => ({ status: "running", checkpoint: observing() }),
          context,
        );
        if (
          task.input.runtimeId !== processes.id ||
          processes.closed ||
          runtime.signal.aborted
        )
          return;
        const info = processes.manager.start(
          task.input.name,
          task.input.command,
          task.input.cwd,
          processes.options.env,
        );
        processes.track(info, task.input, task.id, watches);
        await runtime.commit(
          () => ({ status: "running", checkpoint: observing(info) }),
          context,
        );
      },
      async observe(task, runtime, context) {
        const found = processes.findProcess(task.input, task.id);
        if (found && task.state.checkpoint.processId === null) {
          await runtime.commit(
            () => ({ status: "running", checkpoint: observing(found) }),
            context,
          );
        }
        const info = found
          ? await processes.observe(found.id, runtime.signal)
          : null;
        const sameRuntime =
          task.input.runtimeId === processes.id && !processes.closed;
        const processId = found?.id ?? task.state.checkpoint.processId;
        const result: ProcessTaskResult = info
          ? { status: "ended", process: info }
          : {
              status: "lost",
              reason:
                sameRuntime && processId === null
                  ? "spawn_outcome_unknown"
                  : "manager_state_lost",
              processId,
            };
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: { status: "completed", result },
          }),
          context,
        );
        if (result.status === "ended") processes.notifyEnd(result.process);
        else processes.notifyLost(task.input, task.id, result);
      },
    },
    async abort(task, runtime, context) {
      const info = processes.findProcess(task.input, task.id);
      if (info) {
        const result = await processes.stop(info.id);
        if (!result.ok)
          throw new Error(`Process stop failed: ${result.reason}`);
      }
      await runtime.commit(
        () => ({ status: "terminal", outcome: { status: "aborted" } }),
        context,
      );
    },
  });
}
