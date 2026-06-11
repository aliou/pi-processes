import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { ProcessActionHeader } from "../components";
import type { ProcessesParamsType } from "../schema";
import { buildField } from "../utils";
import type { UpdateDetails } from ".";

export function buildHeader(
  args: ProcessesParamsType,
  theme: Theme,
  options?: { expanded?: boolean },
): Container {
  return new ProcessActionHeader(args, theme, {
    action: "update",
    expanded: options?.expanded,
    suffix: args.id ? theme.fg("accent", `(${args.id})`) : undefined,
  });
}

export function buildExpanded(details: UpdateDetails, theme: Theme): Container {
  const container = new Container();

  if (!details.ok) {
    container.addChild(
      new Text(theme.fg("error", details.error ?? "update failed"), 0, 0),
    );
    return container;
  }

  if (details.renamed && details.previousName && details.process) {
    container.addChild(
      new Text(
        `${theme.fg("muted", "renamed:")} ${details.previousName} -> ${theme.fg("accent", details.process.name)}`,
        0,
        0,
      ),
    );
  }

  if (details.watches.mode) {
    container.addChild(buildWatchSection(details, theme));
  }

  return container;
}

export function buildCollapsed(
  details: UpdateDetails,
  theme: Theme,
): Container {
  const container = new Container();

  if (!details.ok) {
    container.addChild(
      new Text(theme.fg("error", details.error ?? "update failed"), 0, 0),
    );
    return container;
  }

  if (details.renamed && details.previousName && details.process) {
    container.addChild(
      buildField(
        "renamed",
        `${details.previousName} -> ${details.process.name}`,
        theme,
      ),
    );
  }

  if (details.watches.mode) {
    container.addChild(buildWatchSummary(details, theme));
  }

  return container;
}

export function buildFooter(
  _details: UpdateDetails,
  _options: { expanded?: boolean },
  _theme: Theme,
): Container | null {
  return null;
}

// --- Collapsed summary ---

function buildWatchSummary(details: UpdateDetails, theme: Theme): Container {
  const container = new Container();
  const { mode, applied, before, count } = details.watches;

  if (mode === "append") {
    container.addChild(
      buildField(
        "watches",
        `+${applied.length} appended; ${count} active`,
        theme,
      ),
    );
  } else if (mode === "replace") {
    container.addChild(
      buildField(
        "watches",
        `replaced ${before.length} with ${applied.length}; ${count} active`,
        theme,
      ),
    );
  } else if (mode === "remove") {
    const removed = before.length - count;
    container.addChild(
      buildField("watches", `-${removed} removed; ${count} active`, theme),
    );
  } else if (mode === "clear") {
    container.addChild(
      buildField("watches", `cleared ${before.length}; ${count} active`, theme),
    );
  }

  return container;
}

// --- Expanded watch details ---

function buildWatchSection(details: UpdateDetails, theme: Theme): Container {
  const container = new Container();
  const { mode, applied, before, count } = details.watches;

  // Summary line
  if (mode === "append") {
    container.addChild(
      new Text(
        theme.fg(
          "muted",
          `appended ${applied.length} watch${applied.length === 1 ? "" : "es"}; ${count} active`,
        ),
        0,
        0,
      ),
    );
  } else if (mode === "replace") {
    container.addChild(
      new Text(
        theme.fg(
          "muted",
          `replaced ${before.length} with ${applied.length}; ${count} active`,
        ),
        0,
        0,
      ),
    );
  } else if (mode === "remove") {
    const removed = before.length - count;
    container.addChild(
      new Text(
        theme.fg(
          "muted",
          `removed ${removed} watch${removed === 1 ? "" : "es"}; ${count} active`,
        ),
        0,
        0,
      ),
    );
  } else if (mode === "clear") {
    container.addChild(
      new Text(
        theme.fg(
          "muted",
          `cleared ${before.length} watch${before.length === 1 ? "" : "es"}; ${count} active`,
        ),
        0,
        0,
      ),
    );
  }

  // Show applied/added matchers for append and replace
  if (mode === "append" || mode === "replace") {
    for (let i = 0; i < applied.length; i++) {
      container.addChild(buildMatcherLine(applied[i], i, theme, "+ "));
    }
  }

  // Show remaining matchers after remove/clear
  if (mode === "remove" || mode === "clear") {
    const items = details.watches.items;
    for (let i = 0; i < items.length; i++) {
      container.addChild(buildMatcherLine(items[i], i, theme, "  "));
    }
  }

  return container;
}

function buildMatcherLine(
  matcher: {
    pattern: string;
    mode?: string;
    stream?: string;
    repeat?: boolean;
    on?: string;
  },
  index: number,
  theme: Theme,
  prefix: string,
): Text {
  const m = matcher.mode ?? "literal";
  const stream = matcher.stream ?? "both";
  const repeat = matcher.repeat ? " (repeat)" : "";
  const on = matcher.on ?? "turn";

  return new Text(
    theme.fg(
      "muted",
      `${prefix}${index}: [${stream}] ${m} "${matcher.pattern}" -> ${on}${repeat}`,
    ),
    0,
    0,
  );
}
