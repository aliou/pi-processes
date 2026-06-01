import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";

import { stripAnsi } from "../../../../src/utils";
import { ProcessActionHeader } from "../components";
import type { ProcessesParamsType } from "../schema";
import { buildField } from "../utils";
import type { OutputDetails } from ".";

export function buildHeader(
  args: ProcessesParamsType,
  theme: Theme,
  options?: { expanded?: boolean },
): Container {
  const suffix = args.id ? theme.fg("accent", `(${args.id})`) : undefined;
  return new ProcessActionHeader(args, theme, {
    action: "output",
    expanded: options?.expanded,
    suffix,
  });
}

export function buildExpanded(details: OutputDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(buildOutputMeta(details, theme));

  const hasStdout = details.stdout.length > 0;
  const hasStderr = details.stderr.length > 0;

  if (hasStdout) {
    container.addChild(new Spacer(1));
    container.addChild(
      buildStreamSection("stdout", details.stdout, "accent", details, theme),
    );
  }

  if (hasStderr) {
    container.addChild(new Spacer(1));
    container.addChild(
      buildStreamSection("stderr", details.stderr, "warning", details, theme, {
        colorLines: true,
      }),
    );
  }

  if (!hasStdout && !hasStderr) {
    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("muted", emptyMessage(details)), 0, 0),
    );
  }

  return container;
}

export function buildCollapsed(
  details: OutputDetails,
  theme: Theme,
): Container {
  const container = new Container();

  const counts =
    details.stdout.length + details.stderr.length > 0
      ? theme.fg(
          "muted",
          `· ${details.stdout.length} out / ${details.stderr.length} err`,
        )
      : "";

  container.addChild(
    new Text(
      [
        details.processName,
        theme.fg("accent", details.id),
        theme.fg(getStatusTone(details), details.processStatus),
        counts,
      ]
        .filter(Boolean)
        .join("  "),
      0,
      0,
    ),
  );

  const fromStderr = details.stdout.length === 0 && details.stderr.length > 0;
  const source = fromStderr ? details.stderr : details.stdout;
  const preview = source
    .slice(-2)
    .map((l) => stripAnsi(l))
    .join("\n");

  if (preview) {
    container.addChild(
      new Text(theme.fg(fromStderr ? "warning" : "muted", preview), 0, 0),
    );
  } else {
    container.addChild(
      new Text(theme.fg("muted", emptyMessage(details)), 0, 0),
    );
  }

  return container;
}

export function buildFooter(
  details: OutputDetails,
  options: { expanded?: boolean },
  theme: Theme,
): Container | null {
  if (!options.expanded) return null;

  const container = new Container();
  container.addChild(new Text(theme.fg("muted", "logs:"), 0, 0));
  container.addChild(
    new Text(`  ${theme.fg("accent", details.stdoutFile)}`, 0, 0),
  );
  container.addChild(
    new Text(`  ${theme.fg("accent", details.stderrFile)}`, 0, 0),
  );
  return container;
}

function buildOutputMeta(details: OutputDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(buildField("name", details.processName, theme));
  container.addChild(buildField("id", details.id, theme));
  container.addChild(
    buildField(
      "status",
      theme.fg(getStatusTone(details), details.processStatus),
      theme,
    ),
  );
  container.addChild(buildField("stream", details.stream, theme));

  if (details.pattern) {
    const modeTag = details.mode === "regex" ? " (regex)" : "";
    container.addChild(
      buildField("filter", `${details.pattern}${modeTag}`, theme),
    );
  }

  return container;
}

function buildStreamSection(
  label: string,
  lines: string[],
  tone: "accent" | "warning",
  details: OutputDetails,
  theme: Theme,
  options?: { colorLines?: boolean },
): Container {
  const section = new Container();
  const noun = lines.length === 1 ? "line" : "lines";
  const qualifier = details.pattern ? "matching " : "";
  section.addChild(
    new Text(
      theme.fg(tone, `${label} (${lines.length} ${qualifier}${noun}):`),
      0,
      0,
    ),
  );

  for (const line of lines) {
    const text = stripAnsi(line);
    section.addChild(
      new Text(options?.colorLines ? theme.fg(tone, text) : text, 0, 0),
    );
  }

  return section;
}

function emptyMessage(details: OutputDetails): string {
  return details.pattern ? "No matching lines found" : "No output yet";
}

function getStatusTone(
  details: OutputDetails,
): "success" | "warning" | "error" | "muted" {
  if (details.processStatus === "running") return "success";
  if (details.processStatus === "killed") return "warning";
  return "muted";
}
