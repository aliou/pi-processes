import type { ProcessManager } from "../../../../src/manager";

export interface ClearDetails {
  action: "clear";
  cleared: number;
}

export function executeClear(manager: ProcessManager): ClearDetails {
  return {
    action: "clear",
    cleared: manager.clearFinished(),
  };
}

export function formatClearDetails(details: ClearDetails): string {
  if (details.cleared === 0) {
    return "No finished background processes to clear.";
  }

  return `Cleared ${details.cleared} finished background ${details.cleared === 1 ? "process" : "processes"}.`;
}
