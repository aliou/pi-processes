/**
 * Example: publish managed processes over the Program Status Protocol
 * (OSC 7501).
 *
 * Copy this folder to `~/.pi/agent/extensions/process-status/`. Requires
 * `@aliou/pi-processes` (the core extension must be loaded). Set
 * `PI_PROGRAM_STATUS=0` to disable the reports.
 *
 * Record layout:
 *
 *   bg                  group record, app=pi-processes, working while any
 *     bg/proc_ab12      one child per process, title=<process name>
 *
 * Why an extension: the process list lives inside the Pi process, and this
 * reads it over the core extension's event protocol. A standalone script has
 * no way to reach that state.
 *
 * Why a group record instead of the root record: Pi is the program attached to
 * the terminal, so a future Pi release may report its own root record. Writing
 * `bg` leaves the root free, and clearing `bg` still removes the whole subtree
 * in one sequence.
 *
 * Reports go straight to stdout, which is the same fd the TUI renders to. The
 * sequences are non-printing (the terminal consumes them into its record
 * store), so they do not disturb the TUI's differential rendering.
 */

import type { EventBus, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildReports, GROUP_ID } from "./records";
import { ProgramStatusWriter } from "./reporter";
import type { ManagedProcess } from "./types";

const CHANGED_CHANNEL = "processes:changed";
const LIST_CHANNEL = "processes:request:list";
const SYNC_THROTTLE_MS = 125;

export default function processesStatusExtension(pi: ExtensionAPI): void {
  const writer = new ProgramStatusWriter(writeSequence);
  let pendingSync: NodeJS.Timeout | null = null;
  // Nothing is written until the first session tells us the mode.
  let enabled = false;

  const sync = () => {
    if (!enabled) return;
    const processes = requestProcessList(pi.events);
    const reports = buildReports(processes);
    if (reports.length === 0) {
      writer.clear(GROUP_ID);
      return;
    }
    writer.update(reports);
  };

  // Starts, ends, and clears all arrive as `processes:changed`. Coalesce them
  // so a burst of short-lived processes does not produce a burst of writes.
  const scheduleSync = () => {
    if (pendingSync) return;
    pendingSync = setTimeout(() => {
      pendingSync = null;
      sync();
    }, SYNC_THROTTLE_MS);
  };

  const stopListening = pi.events.on(CHANGED_CHANNEL, scheduleSync);

  pi.on("session_start", (_event, ctx) => {
    enabled = ctx.mode === "tui";
    sync();
  });

  pi.on("session_shutdown", () => {
    if (pendingSync) {
      clearTimeout(pendingSync);
      pendingSync = null;
    }
    stopListening();
    // Clear before forgetting: `clear` only writes for records we sent.
    writer.clear(GROUP_ID);
    writer.reset();
  });
}

/** The list request resolves synchronously through its reply callback. */
function requestProcessList(events: EventBus): ManagedProcess[] {
  let processes: ManagedProcess[] = [];
  events.emit(LIST_CHANNEL, {
    reply: (result: ManagedProcess[]) => {
      processes = result;
    },
  });
  return processes;
}

function writeSequence(sequence: string): void {
  if (!process.stdout.isTTY) return;
  if (process.env.PI_PROGRAM_STATUS === "0") return;
  process.stdout.write(sequence);
}
