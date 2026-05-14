import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Send a message via pi, swallowing stale-context errors.
 *
 * After /new, /resume, or /fork, the pi proxy is invalidated and all
 * method calls throw. This wrapper catches that specific error so the
 * extension doesn't crash — the event is simply lost for the old session.
 */
export function safeSendMessage(
  pi: ExtensionAPI,
  message: Parameters<ExtensionAPI["sendMessage"]>[0],
  options?: Parameters<ExtensionAPI["sendMessage"]>[1],
): void {
  try {
    pi.sendMessage(message, options);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("stale")) {
      return;
    }
    throw err;
  }
}
