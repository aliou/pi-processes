import { LIVE_STATUSES, type ProcessInfo } from "../types";
import type { ManagedProcess } from "./internal-types";
import { publicProcessInfo } from "./internal-types";
export class ProcessRegistry {
  private processes: Map<string, ManagedProcess> = new Map();
  private counter = 0;

  nextId(): string {
    return `proc_${++this.counter}`;
  }

  add(process: ManagedProcess): void {
    this.processes.set(process.id, process);
  }

  getRecord(id: string): ManagedProcess | undefined {
    return this.processes.get(id);
  }

  getPublicInfo(id: string): ProcessInfo | null {
    const managed = this.processes.get(id);
    return managed ? publicProcessInfo(managed) : null;
  }

  delete(id: string): boolean {
    return this.processes.delete(id);
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.values())
      .map((p) => publicProcessInfo(p))
      .reverse();
  }

  values(): IterableIterator<ManagedProcess> {
    return this.processes.values();
  }

  entries(): IterableIterator<[string, ManagedProcess]> {
    return this.processes.entries();
  }

  has(id: string): boolean {
    return this.processes.has(id);
  }

  hasAliveishProcesses(): boolean {
    for (const p of this.processes.values()) {
      if (LIVE_STATUSES.has(p.status)) return true;
    }
    return false;
  }

  forEachAlive(callback: (id: string, managed: ManagedProcess) => void): void {
    for (const [id, managed] of this.processes) {
      if (LIVE_STATUSES.has(managed.status)) {
        callback(id, managed);
      }
    }
  }

  [Symbol.dispose](): void {
    this.processes.clear();
  }
}
