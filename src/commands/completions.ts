import type { ProcessManager } from "../manager";

export function runningProcessCompletions(manager: ProcessManager) {
  return (prefix: string) => {
    const processes = manager.list();
    const lower = prefix.toLowerCase();
    return processes
      .filter(
        (p) =>
          p.status === "running" &&
          (p.id.toLowerCase().startsWith(lower) ||
            p.name.toLowerCase().startsWith(lower)),
      )
      .map((p) => ({
        value: p.id,
        label: p.id,
        description: p.name,
      }));
  };
}

export function allProcessCompletions(manager: ProcessManager) {
  return (prefix: string) => {
    const processes = manager.list();
    const lower = prefix.toLowerCase();
    return processes
      .filter(
        (p) =>
          p.id.toLowerCase().startsWith(lower) ||
          p.name.toLowerCase().startsWith(lower),
      )
      .map((p) => ({
        value: p.id,
        label: p.id,
        description: p.name,
      }));
  };
}
