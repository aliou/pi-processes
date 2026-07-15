import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text, visibleWidth } from "@earendil-works/pi-tui";
import { LinesComponent } from "../../../shared/ui";
import { truncateToWidth } from "../../utils/truncate";
import { formatPatternForDisplay, ProcessActionTitle } from "../components";
import type {
  ProcessesParamsType,
  ProcessListSort,
  ProcessListStatusFilter,
} from "../schema";
import { formatColoredProcessStatus, formatCount } from "../utils";
import type { ListDetails, ListProcess, ProcessListCounts } from ".";

type CountStatusItem = {
  filter: ProcessListStatusFilter;
  countKey: keyof Pick<
    ProcessListCounts,
    "running" | "exited" | "failed" | "killed"
  >;
  label: string;
  tone: "success" | "warning" | "error" | "muted";
};

const COUNT_STATUS_ITEMS: CountStatusItem[] = [
  {
    filter: "running",
    countKey: "running",
    label: "running",
    tone: "success",
  },
  {
    filter: "finished",
    countKey: "exited",
    label: "exited",
    tone: "muted",
  },
  {
    filter: "failed",
    countKey: "failed",
    label: "failed",
    tone: "error",
  },
  {
    filter: "killed",
    countKey: "killed",
    label: "killed",
    tone: "warning",
  },
];

export function buildHeader(
  args: ProcessesParamsType,
  theme: Theme,
): Container {
  const header = new Container();
  header.addChild(
    new ProcessActionTitle("list", theme, formatListHeaderSuffix(args, theme)),
  );
  return header;
}

export function buildExpanded(details: ListDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(
    new LinesComponent((width) =>
      formatExpandedProcessLines(details.processes, theme, width),
    ),
  );
  return container;
}

export function buildCollapsed(details: ListDetails, theme: Theme): Container {
  const container = new Container();

  for (const process of details.processes.slice(0, 2)) {
    const parts = [
      process.name,
      theme.fg("accent", process.id),
      `pid ${process.pid}`,
      formatColoredProcessStatus(process, theme),
      theme.fg(
        "muted",
        `${process.watches.length} ${process.watches.length === 1 ? "watch" : "watches"}`,
      ),
    ];
    container.addChild(new Text(parts.join("  "), 0, 0));
  }

  return container;
}

export function buildFooter(
  details: ListDetails,
  _options: { expanded?: boolean },
  theme: Theme,
): Container {
  const footer = new Container();
  footer.addChild(new Text(formatCounts(details, theme), 0, 0));
  return footer;
}

function formatListHeaderSuffix(
  args: ProcessesParamsType,
  theme: Theme,
): string {
  const statuses = normalizeStatuses(args.statuses);
  const parts = [
    `${theme.fg("muted", "sorted")} ${theme.fg("accent", formatSort(args.sortBy ?? "startTime_desc"))}`,
  ];

  if (args.limit) {
    parts.unshift(
      `${theme.fg("muted", "limit")} ${theme.fg("accent", String(args.limit))}`,
    );
  }

  if (!statuses.includes("all")) {
    parts.push(
      `${theme.fg("muted", "statuses")} ${theme.fg("accent", statuses.join(", "))}`,
    );
  }

  return parts.join(theme.fg("dim", " / "));
}

function normalizeStatuses(
  statuses: ProcessListStatusFilter[] | undefined,
): ProcessListStatusFilter[] {
  return statuses && statuses.length > 0 ? statuses : ["all"];
}

function formatSort(sort: ProcessListSort): string {
  switch (sort) {
    case "startTime_desc":
      return "newest first";
    case "startTime_asc":
      return "oldest first";
    case "name_asc":
      return "name A-Z";
    case "name_desc":
      return "name Z-A";
    case "status_asc":
      return "status A-Z";
  }
}

function formatCounts(details: ListDetails, theme: Theme): string {
  if (details.processes.length === 0) {
    return "no process running";
  }

  const statuses = details.filters.statuses;
  const showAll = statuses.includes("all");

  return COUNT_STATUS_ITEMS.filter(
    (item) => showAll || statuses.includes(item.filter),
  )
    .map((item) =>
      theme.fg(
        item.tone,
        `${formatCount(details.counts[item.countKey], "process")} ${item.label}`,
      ),
    )
    .join(theme.fg("dim", " / "));
}

export function formatExpandedProcessLines(
  processes: ListProcess[],
  theme: Theme,
  width: number,
): string[] {
  if (processes.length === 0) {
    return ["No matching background processes."];
  }

  const lines: string[] = [];

  for (const process of processes) {
    if (lines.length > 0) lines.push("");

    const summary = [
      theme.bold(theme.fg("text", formatPatternForDisplay(process.name))),
      `${theme.fg("muted", "pid:")} ${process.pid}`,
      formatColoredProcessStatus(process, theme),
      theme.fg("muted", process.duration),
      `${theme.fg("muted", "(")}${theme.fg("accent", process.id)}${theme.fg("muted", ")")}`,
    ].join(" ");
    lines.push(fitStyledLine(summary, width));

    const command = `${theme.fg("muted", "  $")} ${theme.fg("text", formatPatternForDisplay(process.command))}`;
    lines.push(fitStyledLine(command, width));

    for (const matcher of process.watches) {
      const stream = matcher.stream ?? "both";
      const watch = `${theme.fg("muted", "  ↳")} ${theme.fg("muted", `[${stream}]`)} ${theme.fg("accent", formatPatternForDisplay(matcher.pattern))}`;
      lines.push(fitStyledLine(watch, width));
    }
  }

  return lines;
}

function fitStyledLine(line: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(line) <= width) return line;
  return `${truncateToWidth(line, width)}\u001b[0m`;
}
