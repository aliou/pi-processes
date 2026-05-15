import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { ProcessActionHeader } from "../components";
import type { ProcessesParamsType } from "../schema";
import {
  buildCompactProcessLine,
  buildField,
  buildProcessDetails,
} from "../utils";
import type { StopDetails } from ".";

export function buildHeader(
  args: ProcessesParamsType,
  theme: Theme,
  options?: { expanded?: boolean },
): Container {
  return new ProcessActionHeader(args, theme, {
    action: "stop",
    expanded: options?.expanded,
    suffix: args.id ? theme.fg("accent", `(${args.id})`) : undefined,
  });
}

export function buildExpanded(details: StopDetails, theme: Theme): Container {
  return buildProcessDetails(details.result.info, theme);
}

export function buildCollapsed(details: StopDetails, theme: Theme): Container {
  const container = new Container();
  container.addChild(buildCompactProcessLine(details.result.info, theme));
  if (!details.result.ok) {
    container.addChild(buildField("reason", details.result.reason, theme));
  }
  return container;
}

export function buildFooter(
  _details: StopDetails,
  _options: { expanded?: boolean },
  _theme: Theme,
): Container | null {
  return null;
}
