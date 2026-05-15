import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { ProcessActionHeader } from "../components";
import type { ProcessesParamsType } from "../schema";
import { buildCompactProcessLine, buildProcessDetails } from "../utils";
import type { StartDetails } from ".";

export function buildHeader(
  args: ProcessesParamsType,
  theme: Theme,
  options?: { expanded?: boolean },
): Container {
  return new ProcessActionHeader(args, theme, {
    action: "start",
    expanded: options?.expanded,
    suffix: args.name ? theme.fg("accent", `\`${args.name}\``) : undefined,
  });
}

export function buildExpanded(details: StartDetails, theme: Theme): Container {
  return buildProcessDetails(details.process, theme, { runtime: false });
}

export function buildCollapsed(details: StartDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(buildCompactProcessLine(details.process, theme));
  return container;
}

export function buildFooter(
  _details: StartDetails,
  _options: { expanded?: boolean },
  _theme: Theme,
): Container | null {
  return null;
}
