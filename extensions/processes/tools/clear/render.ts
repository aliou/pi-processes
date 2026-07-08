import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { ProcessActionTitle } from "../components";
import type { ProcessesParamsType } from "../schema";
import { formatCount } from "../utils";
import type { ClearDetails } from ".";

export function buildHeader(
  _args: ProcessesParamsType,
  theme: Theme,
): Container {
  const header = new Container();
  header.addChild(new ProcessActionTitle("clear", theme));
  return header;
}

export function buildExpanded(details: ClearDetails, theme: Theme): Container {
  return buildCollapsed(details, theme);
}

export function buildCollapsed(details: ClearDetails, theme: Theme): Container {
  const container = new Container();
  const tone = details.cleared > 0 ? "success" : "muted";
  container.addChild(
    new Text(
      theme.fg(tone, `${formatCount(details.cleared, "process")} cleared`),
      0,
      0,
    ),
  );
  return container;
}

export function buildFooter(
  _details: ClearDetails,
  _options: { expanded?: boolean },
  _theme: Theme,
): Container | null {
  return null;
}
