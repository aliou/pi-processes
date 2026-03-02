import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { ProcessInfo } from "../../constants";

function formatProcessStatus(
  proc: ProcessInfo,
  theme: ExtensionContext["ui"]["theme"],
): string {
  const name =
    proc.name.length > 20 ? `${proc.name.slice(0, 17)}...` : proc.name;

  switch (proc.status) {
    case "running":
      return `${theme.fg("accent", name)} ${theme.fg("dim", "running")}`;
    case "terminating":
      return `${theme.fg("warning", name)} ${theme.fg("dim", "terminating")}`;
    case "terminate_timeout":
      return `${theme.fg("error", name)} ${theme.fg("error", "terminate_timeout")}`;
    case "killed":
      return `${theme.fg("warning", name)} ${theme.fg("dim", "killed")}`;
    case "exited":
      if (proc.success) {
        return `${theme.fg("dim", name)} ${theme.fg("success", "done")}`;
      }
      return `${theme.fg("error", name)} ${theme.fg("error", `exit(${proc.exitCode ?? "?"})`)}`;
    default:
      return `${theme.fg("dim", name)} ${theme.fg("dim", proc.status)}`;
  }
}

export function renderStatusWidget(
  processes: ProcessInfo[],
  theme: ExtensionContext["ui"]["theme"],
  maxWidth?: number,
): string[] {
  if (processes.length === 0) return [];

  const aliveish = processes.filter(
    (p) =>
      p.status === "running" ||
      p.status === "terminating" ||
      p.status === "terminate_timeout",
  );
  const finished = processes.filter(
    (p) =>
      p.status !== "running" &&
      p.status !== "terminating" &&
      p.status !== "terminate_timeout",
  );

  const allProcs: ProcessInfo[] = [
    ...aliveish,
    ...finished.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0)),
  ];

  const prefix = theme.fg("dim", "processes: ");
  const prefixLen = visibleWidth(prefix);
  const separator = theme.fg("dim", " | ");
  const separatorLen = visibleWidth(separator);
  const effectiveMax = maxWidth ?? 200;

  const parts: string[] = [];
  let currentLen = prefixLen;
  let includedCount = 0;

  for (const proc of allProcs) {
    const formatted = formatProcessStatus(proc, theme);
    const formattedLen = visibleWidth(formatted);
    const remaining = allProcs.length - includedCount - 1;
    const needed =
      includedCount > 0 ? separatorLen + formattedLen : formattedLen;

    let reservedForSuffix = 0;
    if (remaining > 0) {
      const suffixText = `+${remaining} more`;
      reservedForSuffix = separatorLen + visibleWidth(suffixText);
    }

    if (
      currentLen + needed + reservedForSuffix > effectiveMax &&
      includedCount > 0
    ) {
      const hiddenCount = allProcs.length - includedCount;
      if (hiddenCount > 0) parts.push(theme.fg("dim", `+${hiddenCount} more`));
      break;
    }

    parts.push(formatted);
    currentLen += needed;
    includedCount++;
  }

  if (includedCount === 0 && allProcs.length > 0) {
    parts.push(formatProcessStatus(allProcs[0], theme));
  }

  if (parts.length === 0) return [];

  const line = prefix + parts.join(separator);
  return [
    visibleWidth(line) > effectiveMax
      ? truncateToWidth(line, effectiveMax)
      : line,
  ];
}
