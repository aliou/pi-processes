import type { ProcessManager } from "../../../src/manager";
import type { KillResult } from "../../../src/types";
import { LIVE_STATUSES } from "../../../src/types";
import type { NotificationRegistry } from "../notifications/registry";

export async function killIntentionally(
  manager: ProcessManager,
  notifications: NotificationRegistry,
  id: string,
  opts?: { signal?: NodeJS.Signals; timeoutMs?: number },
): Promise<KillResult> {
  notifications.markIntentionalStop(id);

  let result: KillResult;
  try {
    result = await manager.kill(id, opts);
  } catch {
    notifications.consumeIntentionalStop(id);
    throw new Error(`process stop failed for ${id}`);
  }

  if (!result.ok) {
    if (result.reason === "not_found" || result.reason === "error") {
      notifications.consumeIntentionalStop(id);
    }
  } else if (!LIVE_STATUSES.has(result.info.status)) {
    notifications.consumeIntentionalStop(id);
  }

  return result;
}
