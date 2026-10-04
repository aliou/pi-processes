import { randomUUID } from "node:crypto";
import type { TaskId } from "@earendil-works/pi-durable";
import { ProcessManager } from "../src/manager";
import { LIVE_STATUSES, type ProcessInfo } from "../src/types";
import {
  NotificationDelivery,
  type ProcessNotification,
  terminalAttention,
} from "./notifications";
import type { ProcessTaskInput, ProcessTaskResult } from "./process-task";
import type { WatchChange } from "./schema";
import { changeWatches, evaluateWatches, type Watch } from "./watches";

interface Tracking {
  input: ProcessTaskInput;
  taskId: TaskId<ProcessTaskResult>;
  watches: Watch[];
  intentional: boolean;
  notified: boolean;
}

export interface RuntimeOptions {
  manager?: ProcessManager;
  shellPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onNotification?: (notification: ProcessNotification) => void;
}

export class ProcessRuntime {
  readonly id = randomUUID();
  readonly manager: ProcessManager;
  closed = false;
  private records = new Map<string, Tracking>();
  private shutdown = new AbortController();
  private delivery: NotificationDelivery;
  private unsubscribe: () => void;

  constructor(readonly options: RuntimeOptions) {
    this.manager =
      options.manager ??
      new ProcessManager({ getConfiguredShellPath: () => options.shellPath });
    this.delivery = new NotificationDelivery(options.onNotification);
    this.unsubscribe = this.manager.onEvent((event) => {
      if (event.type === "process_output_changed") {
        this.matchOutput(event.id, event.appendedText ?? []);
      }
      if (event.type === "processes_changed") {
        for (const id of this.records.keys())
          if (!this.manager.get(id)) this.records.delete(id);
      }
    });
  }

  track(
    info: ProcessInfo,
    input: ProcessTaskInput,
    taskId: TaskId<ProcessTaskResult>,
    watches: Watch[],
  ): void {
    this.records.set(info.id, {
      input,
      taskId,
      watches,
      intentional: false,
      notified: false,
    });
  }

  tracking(id: string): Tracking | undefined {
    return this.records.get(id);
  }

  findProcess(
    input: ProcessTaskInput,
    taskId: TaskId<ProcessTaskResult>,
  ): ProcessInfo | null {
    if (this.closed || input.runtimeId !== this.id) return null;
    for (const [id, record] of this.records) {
      if (
        record.taskId === taskId &&
        record.input.conversationId === input.conversationId
      )
        return this.manager.get(id);
    }
    return null;
  }

  observe(id: string, signal: AbortSignal): Promise<ProcessInfo | null> {
    if (this.closed) return Promise.resolve(null);
    const cancel = AbortSignal.any([signal, this.shutdown.signal]);
    return new Promise((resolve, reject) => {
      const dispose = () => {
        unsubscribe();
        cancel.removeEventListener("abort", abort);
      };
      const finish = () => {
        const info = this.manager.get(id);
        if (info && LIVE_STATUSES.has(info.status)) return;
        dispose();
        resolve(info);
      };
      const abort = () => {
        dispose();
        if (this.closed) resolve(null);
        else reject(cancel.reason);
      };
      const unsubscribe = this.manager.onEvent(finish);
      cancel.addEventListener("abort", abort, { once: true });
      if (cancel.aborted) {
        abort();
        return;
      }
      finish();
    });
  }

  async stop(
    id: string,
    options?: { signal?: NodeJS.Signals; timeoutMs?: number },
  ) {
    const record = this.records.get(id);
    if (record) record.intentional = true;
    const result = await this.manager.kill(id, options);
    if (result.ok) this.notifyEnd(result.info);
    if (!result.ok && record)
      this.delivery.deliver({
        conversationId: record.input.conversationId,
        taskId: record.taskId,
        processId: id,
        kind: "stop_failed",
        attention: "context",
        summary: `Could not stop ${result.info.name}: ${result.reason}.`,
      });
    return result;
  }

  notifyEnd(info: ProcessInfo): void {
    const record = this.records.get(info.id);
    if (!record || record.notified) return;
    record.notified = true;
    const attention = terminalAttention(
      info,
      record.input.notify,
      record.intentional,
    );
    if (attention === null) return;
    this.delivery.deliver({
      conversationId: record.input.conversationId,
      taskId: record.taskId,
      processId: info.id,
      kind:
        info.status === "killed" ? "killed" : info.success ? "exit" : "crash",
      attention,
      summary: `${info.name}: ${info.endReason ?? info.status}${info.errorMessage ? ` (${info.errorMessage.slice(0, 1000)})` : ""}.`,
    });
  }

  notifyLost(
    input: ProcessTaskInput,
    taskId: TaskId<ProcessTaskResult>,
    lost: Extract<ProcessTaskResult, { status: "lost" }>,
  ): void {
    this.delivery.deliver({
      conversationId: input.conversationId,
      taskId,
      processId: lost.processId,
      kind: "tracking_lost",
      attention: "context",
      lost,
      summary: `Tracking lost for ${input.name}: ${lost.reason}. The command may still be running.`,
    });
  }

  updateWatches(id: string, change: WatchChange): void {
    const record = this.records.get(id);
    if (!record)
      throw new Error(
        "Log watches require a process owned by this durable extension",
      );
    record.watches = changeWatches(record.watches, change);
  }

  private matchOutput(
    id: string,
    appended: Array<{ type: "stdout" | "stderr"; text: string }>,
  ): void {
    const record = this.records.get(id);
    if (!record) return;
    const name = this.manager.get(id)?.name ?? record.input.name;
    for (const match of evaluateWatches(record.watches, appended, Date.now()))
      this.delivery.deliver({
        conversationId: record.input.conversationId,
        taskId: record.taskId,
        processId: id,
        kind: "log_match",
        attention: match.attention,
        match,
        summary: `${name} matched ${JSON.stringify(match.pattern)}: ${match.line}`,
      });
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.delivery.dispose();
    this.shutdown.abort();
    this.records.clear();
    if (!this.options.manager) this.manager.cleanup();
  }
}
