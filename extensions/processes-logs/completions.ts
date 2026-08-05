import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  formatProcessSelectionDescription,
  formatProcessSelectionLabel,
} from "../shared/ui";
import { requestProcessList } from "./client";

export function allProcessCompletions(
  events: EventBus,
): (prefix: string) => AutocompleteItem[] | null {
  return (prefix) => buildCompletions(events, prefix);
}

function buildCompletions(
  events: EventBus,
  prefix: string,
): AutocompleteItem[] | null {
  const processes = requestProcessList(events);
  const normalizedPrefix = prefix.trim().toLowerCase();
  const items = processes
    .filter(
      (process) =>
        process.id.toLowerCase().startsWith(normalizedPrefix) ||
        process.name.toLowerCase().includes(normalizedPrefix),
    )
    .map((process) => ({
      value: process.id,
      label: formatProcessSelectionLabel(process),
      description: formatProcessSelectionDescription(process),
    }));

  return items.length > 0 ? items : null;
}
