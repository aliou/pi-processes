import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { buildMatcherLine, ProcessActionHeader } from "../components";
import type { ProcessesParamsType } from "../schema";
import {
  buildCompactProcessLine,
  buildField,
  buildProcessDetails,
} from "../utils";
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
  const container = buildProcessDetails(details.process, theme, {
    runtime: false,
  });
  const watches = details.notify.logMatches ?? [];

  if (watches.length > 0) {
    container.addChild(
      new Text(
        theme.bold(
          theme.fg(
            "text",
            `watches ${theme.fg("muted", `(${watches.length})`)}`,
          ),
        ),
        0,
        0,
      ),
    );
    for (const matcher of watches) {
      container.addChild(buildMatcherLine(matcher, theme, "  "));
    }
  }

  return container;
}

export function buildCollapsed(details: StartDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(buildCompactProcessLine(details.process, theme));
  const watchCount = details.notify.logMatches?.length ?? 0;
  if (watchCount > 0) {
    container.addChild(buildField("watches", watchCount, theme));
  }
  return container;
}

export function buildFooter(
  _details: StartDetails,
  _options: { expanded?: boolean },
  _theme: Theme,
): Container | null {
  return null;
}
