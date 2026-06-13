import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { ProcessInfo } from "../../src/types";
import { formatStatus } from "../../src/utils/format";
import { requestProcessList } from "./client";

export function allProcessCompletions(
  events: EventBus,
): (prefix: string) => AutocompleteItem[] | null {
  return (prefix) => buildCompletions(events, prefix, () => true);
}

export function runningProcessCompletions(
  events: EventBus,
): (prefix: string) => AutocompleteItem[] | null {
  return (prefix) =>
    buildCompletions(events, prefix, (process) => process.status === "running");
}

function buildCompletions(
  events: EventBus,
  prefix: string,
  filter: (process: ProcessInfo) => boolean,
): AutocompleteItem[] | null {
  const processes = requestProcessList(events).filter(filter);
  const normalizedPrefix = prefix.trim().toLowerCase();
  const items = processes
    .filter(
      (process) =>
        process.id.toLowerCase().startsWith(normalizedPrefix) ||
        process.name.toLowerCase().includes(normalizedPrefix),
    )
    .map((process) => ({
      value: process.id,
      label: `${process.name} (${process.id})`,
      description: `${formatStatus(process)} — ${process.command}`,
    }));

  return items.length > 0 ? items : null;
}
