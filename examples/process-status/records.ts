import type { ProgramState, StatusReport } from "./reporter";
import { LIVE_STATUSES, type ManagedProcess } from "./types";

/** Stable program id the terminal groups our records under. */
export const APP = "pi-processes";

/**
 * The group record. Reports hang off this id instead of the root record so a
 * future Pi release can own the root without the two fighting over it. Every
 * child inherits `app` from here, so children only carry `title`.
 */
export const GROUP_ID = "bg";

/** Process ids are opaque; normalize them into one valid id segment. */
export function processRecordId(processId: string): string {
  const segment = processId.replace(/[^A-Za-z0-9_.+-]/g, "_").slice(0, 32);
  return `${GROUP_ID}/${segment || "unknown"}`;
}

/** Map a process onto a protocol state. */
export function processState(info: ManagedProcess): ProgramState {
  if (LIVE_STATUSES.has(info.status)) return "working";
  if (info.status === "killed") return "done";
  return info.success === false ? "error" : "done";
}

/** "<1s", "3s", "2m 15s", "1h 30m" */
function formatRuntime(startTime: number, endTime: number | null): string {
  const ms = Math.max(0, (endTime ?? Date.now()) - startTime);
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  if (seconds > 0) return `${seconds}s`;
  return "<1s";
}

function processMessage(info: ManagedProcess): string {
  if (LIVE_STATUSES.has(info.status)) {
    return info.status === "running" ? info.command : info.status;
  }
  if (info.errorMessage) return info.errorMessage;
  if (info.status === "killed") return "Killed";
  const runtime = formatRuntime(info.startTime, info.endTime);
  if (info.status === "exited") {
    return `Exited ${info.exitCode ?? "?"} in ${runtime}`;
  }
  return `${info.status} after ${runtime}`;
}

function groupMessage(processes: ManagedProcess[]): string {
  const running = processes.filter((p) => LIVE_STATUSES.has(p.status)).length;
  if (running > 0) return `${running} running`;
  const failed = processes.filter((p) => processState(p) === "error").length;
  if (failed > 0) return `${failed} failed`;
  return `${processes.length} finished`;
}

/**
 * Build the full desired record set: the group record first (so children have
 * an ancestor carrying `app`), then one child per process. An empty list
 * produces no reports, which clears the whole subtree in the writer.
 */
export function buildReports(processes: ManagedProcess[]): StatusReport[] {
  if (processes.length === 0) return [];

  const running = processes.some((p) => LIVE_STATUSES.has(p.status));
  const reports: StatusReport[] = [
    {
      id: GROUP_ID,
      app: APP,
      state: running ? "working" : "idle",
      title: "pi processes",
      msg: groupMessage(processes),
    },
  ];

  for (const info of processes) {
    reports.push({
      id: processRecordId(info.id),
      state: processState(info),
      title: info.name,
      msg: processMessage(info),
    });
  }

  return reports;
}
