import { ToolBody, ToolFooter } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type { ExecuteResult, ProcessesDetails } from "../../constants";
import { t } from "../../i18n";
import type { ProcessManager } from "../../manager";
import {
  formatRuntime,
  formatStatus,
  formatStatusTag,
  formatTimestamp,
  truncateCmd,
} from "../../utils";

export function executeList(manager: ProcessManager): ExecuteResult {
  const processes = manager.list();

  if (processes.length === 0) {
    return {
      content: [{ type: "text", text: t("list.none") }],
      details: {
        action: "list",
        success: true,
        message: t("list.none"),
        processes: [],
      },
    };
  }

  const summary = processes
    .map(
      (p) =>
        `${p.id} "${p.name}": ${truncateCmd(p.command)} [${formatStatus(p)}] ${formatRuntime(p.startTime, p.endTime)}`,
    )
    .join("\n");

  const message = t("list.summary", { count: processes.length, summary });
  return {
    content: [{ type: "text", text: message }],
    details: {
      action: "list",
      success: true,
      message,
      processes,
    },
  };
}

export function renderListResult(
  result: AgentToolResult<ProcessesDetails>,
  options: ToolRenderResultOptions,
  theme: Theme,
): ToolBody {
  const { details } = result;

  if (!details.processes || details.processes.length === 0) {
    return new ToolBody(
      {
        fields: [
          {
            label: t("list.field.processes"),
            value: t("list.none"),
            showCollapsed: true,
          },
        ],
      },
      options,
      theme,
    );
  }

  const processes = [...details.processes];

  const statusRank = (status: string): number => {
    switch (status) {
      case "running":
        return 0;
      case "terminating":
        return 1;
      case "terminate_timeout":
        return 2;
      case "killed":
        return 3;
      case "exited":
        return 4;
      default:
        return 5;
    }
  };

  processes.sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return b.startTime - a.startTime;
  });

  const runningCount = processes.filter(
    (p) => p.status === "running" || p.status === "terminating",
  ).length;

  const lines: string[] = [
    theme.fg(
      "success",
      t("list.header", { count: processes.length, running: runningCount }),
    ),
  ];

  for (const process of processes) {
    const status = formatStatusTag(process, theme);
    lines.push(
      [
        `- ${theme.fg("accent", process.name)} ${theme.fg("muted", `(${process.id})`)}`,
        `  ${t("list.pid")}: ${process.pid}   ${t("list.status")}: ${status}`,
        `  ${t("list.started")}: ${theme.fg("muted", formatTimestamp(process.startTime))}`,
        `  ${t("list.ended")}:   ${theme.fg("muted", formatTimestamp(process.endTime))}`,
        `  ${t("list.runtime")}: ${theme.fg("muted", formatRuntime(process.startTime, process.endTime))}`,
      ].join("\n"),
    );
  }

  const fields: Array<
    { label: string; value: string; showCollapsed?: boolean } | Text
  > = [new Text(lines.join("\n"), 0, 0)];

  const running = details.processes.filter(
    (p) => p.status === "running" || p.status === "terminating",
  );
  const finishedOk = details.processes.filter(
    (p) => p.status === "exited" && p.success,
  ).length;
  const failed = details.processes.filter(
    (p) => p.status === "exited" && !p.success,
  ).length;
  const killed = details.processes.filter((p) => p.status === "killed").length;

  const runningSummary =
    running.length > 0
      ? running
          .slice(0, 3)
          .map(
            (p) =>
              `${theme.fg("accent", `"${p.name}"`)} [${formatStatusTag(p, theme)}]`,
          )
          .join(", ")
      : theme.fg("muted", t("list.noRunning"));

  const restParts: string[] = [];
  if (finishedOk > 0) restParts.push(t("list.finished", { count: finishedOk }));
  if (failed > 0) restParts.push(t("list.failed", { count: failed }));
  if (killed > 0) restParts.push(t("list.killed", { count: killed }));
  const restSummary =
    restParts.length > 0 ? theme.fg("muted", ` + ${restParts.join(", ")}`) : "";

  fields.push({
    label: t("list.field.processes"),
    value: runningSummary + restSummary,
    showCollapsed: true,
  });

  const footerItems: Array<{
    label: string;
    value: string;
  }> = [];
  if (runningCount > 0) {
    footerItems.push({
      label: t("footer.running"),
      value: String(runningCount),
    });
  }
  if (failed > 0) {
    footerItems.push({ label: t("footer.failed"), value: String(failed) });
  }
  if (killed > 0) {
    footerItems.push({ label: t("footer.killed"), value: String(killed) });
  }

  return new ToolBody(
    {
      fields,
      footer:
        footerItems.length > 0
          ? new ToolFooter(theme, { items: footerItems, separator: " | " })
          : undefined,
    },
    options,
    theme,
  );
}
