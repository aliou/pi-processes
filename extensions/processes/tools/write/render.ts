import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { ProcessActionHeader } from "../components";
import type { ProcessesParamsType } from "../schema";
import { buildField } from "../utils";
import type { WriteDetails } from ".";

export function buildHeader(
  args: ProcessesParamsType,
  theme: Theme,
  options?: { expanded?: boolean },
): Container {
  return new ProcessActionHeader(args, theme, {
    action: "write",
    expanded: options?.expanded,
    suffix: args.id ? theme.fg("accent", `(${args.id})`) : undefined,
  });
}

export function buildExpanded(details: WriteDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(buildSummary(details, theme));
  return container;
}

export function buildCollapsed(details: WriteDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(buildSummary(details, theme));
  return container;
}

export function buildFooter(
  _details: WriteDetails,
  _options: { expanded?: boolean },
  _theme: Theme,
): Container | null {
  return null;
}

function buildSummary(details: WriteDetails, theme: Theme): Container {
  const container = new Container();

  if (!details.ok) {
    container.addChild(
      new Text(
        theme.fg("error", `stdin write failed: ${details.reason ?? "unknown"}`),
        0,
        0,
      ),
    );
    container.addChild(buildField("process", details.processName, theme));
    return container;
  }

  const closeTag = details.end ? " (stdin closed)" : "";
  container.addChild(
    new Text(
      theme.fg(
        "muted",
        `wrote ${details.bytes} byte${details.bytes === 1 ? "" : "s"}${closeTag}`,
      ),
      0,
      0,
    ),
  );
  container.addChild(buildField("process", details.processName, theme));
  return container;
}
