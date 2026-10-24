import type { ProcessManager } from "../../../src/manager";
import type { KillResult } from "../../../src/types";
import { LIVE_STATUSES } from "../../../src/types";

export async function killIntentionally(
  manager: ProcessManager,
  id: string,
  opts?: { signal?: NodeJS.Signals; timeoutMs?: number },
): Promise<KillResult> {
  manager.markIntentionalStop(id);

  let result: KillResult;
  try {
    result = await manager.kill(id, opts);
  } catch {
    manager.consumeIntentionalStop(id);
    throw new Error(`process stop failed for ${id}`);
  }

  if (!result.ok) {
    if (result.reason === "not_found" || result.reason === "error") {
      manager.consumeIntentionalStop(id);
    }
  } else if (!LIVE_STATUSES.has(result.info.status)) {
    manager.consumeIntentionalStop(id);
  }

  return result;
}
