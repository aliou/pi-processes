import type { ProcessManager } from "../../../../src/manager";
import type { KillResult } from "../../../../src/types";
import type { ProcessesParamsType } from "../schema";

export interface StopDetails {
  action: "stop";
  result: KillResult;
}

export async function executeStop(
  params: ProcessesParamsType,
  manager: ProcessManager,
): Promise<StopDetails> {
  if (!params.id) {
    throw new Error("process stop requires id");
  }

  return {
    action: "stop",
    result: await manager.kill(params.id),
  };
}

export function formatStopDetails(details: StopDetails): string {
  if (details.result.ok) {
    return `Stopped process ${details.result.info.name} (${details.result.info.id}).`;
  }

  return `Failed to stop process ${details.result.info.id}: ${details.result.reason}.`;
}
