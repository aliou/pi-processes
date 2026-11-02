import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { ProcessManager } from "../../../../src/manager";
import { LIVE_STATUSES, type ProcessInfo } from "../../../../src/types";
import type { NotificationRegistry } from "../../notifications/registry";
import { normalizeNotifyConfig } from "../notify";
import type { ProcessesParamsType, StartDetails } from "../schema";
import { formatMatcherForModel } from "../watch-format";
import { buildSessionEnv } from "./session-env";

export async function executeStart(
  params: ProcessesParamsType,
  manager: ProcessManager,
  ctx: ExtensionContext,
  notifications: NotificationRegistry,
): Promise<StartDetails> {
  if (!params.name) {
    throw new Error("process start requires name");
  }

  if (!params.command) {
    throw new Error("process start requires command");
  }

  const notify = normalizeNotifyConfig(params.notify);

  const cwd = params.cwd ?? ctx.cwd;
  const process = await manager.start(
    params.name,
    params.command,
    cwd,
    buildSessionEnv(ctx),
  );
  notifications.register(process.id, notify);
  if (!LIVE_STATUSES.has(process.status)) {
    notifications.markStartReported(process.id);
    if (process.success === false) {
      throw new Error(describeStartOutcome(process));
    }
  }

  return {
    action: "start",
    process,
    notify,
  };
}

export function formatStartDetails(details: StartDetails): string {
  const process = details.process;
  const parts = [describeStartOutcome(process)];

  if (details.notify.logMatches && details.notify.logMatches.length > 0) {
    parts.push(
      `Watches:\n${details.notify.logMatches
        .map((matcher) => formatMatcherForModel(matcher))
        .join("\n")}`,
    );
    parts.push(
      "Continue other work; watch notifications will trigger follow-up.",
    );
  }

  return parts.join(" ");
}

function describeStartOutcome(process: ProcessInfo): string {
  if (LIVE_STATUSES.has(process.status)) {
    return `Started process ${process.name} (${process.id}) with pid ${process.pid}.`;
  }
  return `Process ${process.name} (${process.id}) exited immediately: ${describeEarlyEnd(process)}.`;
}

function describeEarlyEnd(process: ProcessInfo): string {
  if (
    process.endReason === "spawn_error" ||
    process.endReason === "missing_pid"
  ) {
    return process.errorMessage
      ? `failed to spawn (${process.errorMessage})`
      : "failed to spawn";
  }
  if (process.status === "killed" && process.signal) {
    return `killed by ${process.signal.name}`;
  }
  if (process.exitCode !== null) {
    return `exit code ${process.exitCode}`;
  }
  return `ended with reason ${process.endReason ?? "unknown"}`;
}
