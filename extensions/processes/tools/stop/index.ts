import type { ProcessManager } from "../../../../src/manager";
import { killIntentionally } from "../../handlers/kill-process";
import type { NotificationRegistry } from "../../notifications/registry";
import type { ProcessesParamsType, StopDetails } from "../schema";

export async function executeStop(
  params: ProcessesParamsType,
  manager: ProcessManager,
  notifications: NotificationRegistry,
): Promise<StopDetails> {
  if (!params.id) {
    throw new Error("process stop requires id");
  }

  const result = await killIntentionally(manager, notifications, params.id);

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
