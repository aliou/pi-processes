import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { requestStart } from "../processes/client";

/**
 * Debug extension for pi-processes.
 *
 * This extension is NOT listed in `package.json` under `pi.extensions`.
 * Load it explicitly via `pi -ne -e ~/pi-processes-debug/`.
 *
 * It provides "programmatic" control over process management by exposing
 * slash commands that go through the core extension's protocol channels,
 * so processes started here are fully visible to the agent's `process` tool.
 * This lets you start a background process during debugging without needing
 * to prompt the agent.
 */
export default async function processesDebugExtension(
  pi: ExtensionAPI,
): Promise<void> {
  const events = pi.events;

  pi.registerCommand("debug:ps:start", {
    description:
      "Start a background process (debug). Usage: /debug:ps:start <name> <command>",
    handler: async (args: string, ctx) => {
      const parsed = parseStartArgs(args);
      if (!parsed) {
        ctx.ui.notify("Usage: /debug:ps:start <name> <command>", "warning");
        return;
      }

      const result = await requestStart(events, {
        name: parsed.name,
        command: parsed.command,
        cwd: ctx.cwd,
      });

      if (result.ok) {
        ctx.ui.notify(
          `Started ${result.process.name} (${result.process.id}) — pid ${result.process.pid}`,
          "info",
        );
      } else {
        ctx.ui.notify(`Failed to start process: ${result.error}`, "warning");
      }
    },
  });
}

interface ParsedStartArgs {
  name: string;
  command: string;
}

function parseStartArgs(args: string): ParsedStartArgs | null {
  const trimmed = args.trim();
  if (!trimmed) return null;

  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) return null;

  const name = trimmed.slice(0, firstSpace);
  const command = trimmed.slice(firstSpace + 1).trim();
  if (!command) return null;

  return { name, command };
}
