import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getManager } from "../../src/get-manager";
import { isWindowsPlatform } from "../../src/utils/platform";
import { configLoader, loadCodexExecConfig } from "./config";
import { registerCodexExecSettings } from "./settings";
import { registerCodexExecTools } from "./tools";

/**
 * codex-unified-exec extension.
 *
 * Emulates OpenAI Codex's unified_exec session model (exec_command +
 * write_stdin) over pi-processes's ProcessManager. Disabled by default; toggle
 * on via /codex-exec:settings. POSIX-only, like the rest of pi-processes.
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

  // Settings are always registered so users can toggle the extension on even
  // while it is disabled.
  await loadCodexExecConfig();
  registerCodexExecSettings(pi);

  const config = configLoader.getConfig();
  if (!config.enabled) {
    return;
  }

  // Own ProcessManager instance for isolation: codex sessions live in a
  // separate registry from the processes extension's /ps sessions. The
  // extension owns shutdown and must killAll + cleanup.
  const manager = getManager();

  let disposed = false;
  pi.on("session_shutdown", async () => {
    if (disposed) return;
    disposed = true;
    manager.killAll();
    manager.cleanup();
  });

  // Chunk 1: tools are a no-op stub. Chunk 2 wires exec_command + write_stdin
  // to a session wrapper around this manager + HeadTailBuffer +
  // collectOutputUntilDeadline.
  registerCodexExecTools(pi, manager);
}
