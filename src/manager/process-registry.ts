import { randomBytes } from "node:crypto";

import { LIVE_STATUSES, type ProcessInfo } from "../types";
import type { ManagedProcessRecord } from "./internal-types";
import { formatProcess } from "./internal-types";

export class ProcessRegistry {
  private processes: Map<string, ManagedProcessRecord> = new Map();

  nextId(): string {
    let id: string;
    do {
      id = `proc_${randomBytes(2).toString("hex")}`;
    } while (this.processes.has(id));
    return id;
  }

  add(process: ManagedProcessRecord): void {
    this.processes.set(process.id, process);
  }

  getRecord(id: string): ManagedProcessRecord | undefined {
    return this.processes.get(id);
  }

  getPublicInfo(id: string): ProcessInfo | null {
    const managed = this.processes.get(id);
    return managed ? formatProcess(managed) : null;
  }

  delete(id: string): boolean {
    return this.processes.delete(id);
  }

  list(): ProcessInfo[] {
    return Array.from(this.processes.values()).map((p) => formatProcess(p));
  }

  values(): IterableIterator<ManagedProcessRecord> {
    return this.processes.values();
  }

  entries(): IterableIterator<[string, ManagedProcessRecord]> {
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

  forEachAlive(
    callback: (id: string, managed: ManagedProcessRecord) => void,
  ): void {
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
