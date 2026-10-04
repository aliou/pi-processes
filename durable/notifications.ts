import type { ConversationId, TaskId } from "@earendil-works/pi-durable";
import type { ProcessInfo } from "../src/types";
import type { ProcessTaskResult } from "./process-task";
import type { NotifyConfig } from "./schema";
import type { WatchMatch } from "./watches";

export interface ProcessNotification {
  conversationId: ConversationId;
  taskId: TaskId<ProcessTaskResult> | null;
  processId: string | null;
  kind:
    | "exit"
    | "crash"
    | "killed"
    | "stop_failed"
    | "log_match"
    | "log_match_suppressed"
    | "tracking_lost";
  attention: "turn" | "context" | "ignore";
  summary: string;
  match?: WatchMatch;
  lost?: Extract<ProcessTaskResult, { status: "lost" }>;
}

export function terminalAttention(
  info: Pick<ProcessInfo, "status" | "success">,
  config: NotifyConfig,
  intentional: boolean,
): ProcessNotification["attention"] | null {
  if (intentional) return "context";
  if (info.status === "killed") {
    const on = config.onKilled ?? "context";
    return on === "ignore" ? null : on;
  }
  if (info.success) {
    const on = config.onSuccess ?? "turn";
    return on === "ignore" ? null : on;
  }
  const on = config.onFailure ?? "turn";
  return on === "ignore" ? "context" : on;
}

interface Window {
  sent: number;
  suppressed: number;
  timer: ReturnType<typeof setTimeout>;
}

export class NotificationDelivery {
  private windows = new Map<ConversationId, Window>();
  private closed = false;

  constructor(private send?: (notification: ProcessNotification) => void) {}

  deliver(notification: ProcessNotification): void {
    if (this.closed || !this.send) return;
    if (notification.kind !== "log_match") {
      this.send(notification);
      return;
    }
    const window = this.window(notification.conversationId);
    if (window.sent >= 20) {
      window.suppressed++;
      return;
    }
    window.sent++;
    this.send(notification);
  }

  private window(conversationId: ConversationId): Window {
    const existing = this.windows.get(conversationId);
    if (existing) return existing;
    const timer = setTimeout(() => this.flush(conversationId), 60_000);
    timer.unref?.();
    const window = { sent: 0, suppressed: 0, timer };
    this.windows.set(conversationId, window);
    return window;
  }

  private flush(conversationId: ConversationId): void {
    const window = this.windows.get(conversationId);
    this.windows.delete(conversationId);
    if (!window?.suppressed) return;
    this.deliver({
      conversationId,
      taskId: null,
      processId: null,
      kind: "log_match_suppressed",
      attention: "context",
      summary: `Suppressed ${window.suppressed} log-match notifications because output was too fast.`,
    });
  }

  dispose(): void {
    this.closed = true;
    for (const window of this.windows.values()) clearTimeout(window.timer);
    this.windows.clear();
  }
}
