import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { ProcessActionTitle } from "../components";
import type {
  ProcessesParamsType,
  ProcessListSort,
  ProcessListStatusFilter,
} from "../schema";
import {
  buildProcessSummaryRow,
  formatColoredProcessStatus,
  formatCount,
} from "../utils";
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
    new Markdown(
      formatProcessTable(details.processes, theme),
      0,
      0,
      getMarkdownTheme(),
    ),
  );
  return container;
}

export function buildCollapsed(details: ListDetails, theme: Theme): Container {
  const container = new Container();

  for (const process of details.processes.slice(0, 2)) {
    container.addChild(buildProcessSummaryRow(process, theme));
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

function formatProcessTable(processes: ListProcess[], theme: Theme): string {
  if (processes.length === 0) {
    return "No matching background processes.";
  }

  const rows = processes.map((process) =>
    [
      escapeTableCell(process.name),
      process.id,
      String(process.pid),
      formatColoredProcessStatus(process, theme),
      process.duration,
      escapeTableCell(process.command),
    ].join(" | "),
  );

  return [
    "| Name | ID | PID | Status | Duration | Command |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
