import type { ProcessManager } from "../../../../src/manager";
import type { KillResult } from "../../../../src/types";
import { LIVE_STATUSES } from "../../../../src/types";
import type { NotificationRegistry } from "../../notifications/registry";
import type { ProcessesParamsType } from "../schema";

export interface StopDetails {
  action: "stop";
  result: KillResult;
}

export async function executeStop(
  params: ProcessesParamsType,
  manager: ProcessManager,
  notifications: NotificationRegistry,
): Promise<StopDetails> {
  if (!params.id) {
    throw new Error("process stop requires id");
  }

  notifications.markIntentionalStop(params.id);

  let result: KillResult;
  try {
    result = await manager.kill(params.id);
  } catch {
    notifications.consumeIntentionalStop(params.id);
    throw new Error(`process stop failed for ${params.id}`);
  }

  if (!result.ok) {
    if (result.reason === "not_found" || result.reason === "error") {
      notifications.consumeIntentionalStop(params.id);
    }
  } else if (!LIVE_STATUSES.has(result.info.status)) {
    notifications.consumeIntentionalStop(params.id);
  }

  return {
    action: "stop",
    result,
  };
}

export function formatStopDetails(details: StopDetails): string {
  if (details.result.ok) {
    return `Stopped process ${details.result.info.name} (${details.result.info.id}).`;
  }

  return `Failed to stop process ${details.result.info.id}: ${details.result.reason}.`;
}
