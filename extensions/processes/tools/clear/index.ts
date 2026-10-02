import type { ProcessManager } from "../../../../src/manager";
import type { ClearDetails } from "../schema";

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
