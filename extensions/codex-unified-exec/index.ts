import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getManager } from "../../src/get-manager";
import { isWindowsPlatform } from "../../src/utils/platform";
import { configLoader } from "../processes/config";
import { SessionManager } from "./session";
import { registerCodexExecTools } from "./tools";

/**
 * codex-unified-exec extension.
 *
 * Emulates OpenAI Codex's unified_exec session model (exec_command + write_stdin)
 * over pi-processes's ProcessManager. Disabled by default; toggle on via
 * /ps:settings (the `codexExec.enabled` field, shared with the processes settings
 * rather than a separate settings command). POSIX-only, like the rest of
 * pi-processes.
 */
export default async function codexUnifiedExecExtension(
  pi: ExtensionAPI,
): Promise<void> {
  if (isWindowsPlatform()) {
    // POSIX-only: ProcessManager relies on detached process groups and
    // negative-pid group kill, neither of which exists on Windows.
    pi.on("session_start", (_event, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.notify(
        "The codex-unified-exec extension is not available on Windows.",
        "warning",
      );
    });
    return;
  }

  // `enabled` is part of the pi-processes config (edited via /ps:settings), so
  // the processes extension's ConfigLoader owns it. Processes is listed before
  // this extension in package.json pi.extensions and pi loads extensions
  // sequentially with await, so loadProcessConfig() has already completed by
  // the time this factory runs and getConfig() is safe here.
  const enabled = configLoader.getConfig().codexExec.enabled;
  if (!enabled) {
    return;
  }

  // Own ProcessManager + SessionManager for isolation: codex sessions live in a
  // separate registry from the processes extension's /ps sessions. The default
  // shell follows the user's pi-processes `execution.shellPath` so codex's
  // "defaults to the user's default shell" is honored; a model-provided `shell`
  // overrides per-spawn.
  const resolvedShellPath = configLoader.getConfig().execution.shellPath;
  const manager = getManager({
    getConfiguredShellPath: () => resolvedShellPath,
  });
  const sessions = new SessionManager(manager);

  let disposed = false;
  pi.on("session_shutdown", async () => {
    if (disposed) return;
    disposed = true;
    sessions.dispose();
  });

  registerCodexExecTools(pi, sessions);
}
