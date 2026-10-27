import { LIVE_STATUSES, type ProcessInfo } from "../../../src/types";

export class ProcessFocus {
  private active = false;
  private selectedId: string | null = null;
  private savedFocusedProcessId: string | null = null;

  get isActive(): boolean {
    return this.active;
  }

  enter(processes: ProcessInfo[], currentFocusedId: string | null): void {
    this.active = true;
    this.savedFocusedProcessId = currentFocusedId;
    this.selectedId = this.defaultSelection(processes)?.id ?? null;
  }

  move(delta: number, processes: ProcessInfo[]): void {
    const index = processes.findIndex(
      (process) => process.id === this.selectedId,
    );
    if (index < 0) return;
    const next = Math.min(
      Math.max(index + delta, 0),
      Math.max(0, processes.length - 1),
    );
    this.selectedId = processes[next]?.id ?? null;
  }

  select(processes: ProcessInfo[]): ProcessInfo | null {
    return processes.find((process) => process.id === this.selectedId) ?? null;
  }

  exit(): string | null {
    this.active = false;
    const restored = this.savedFocusedProcessId;
    this.savedFocusedProcessId = null;
    return restored;
  }

  private defaultSelection(processes: ProcessInfo[]): ProcessInfo | null {
    return (
      processes.find((process) => LIVE_STATUSES.has(process.status)) ??
      processes[0] ??
      null
    );
  }
}
