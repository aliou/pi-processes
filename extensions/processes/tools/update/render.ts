import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { LogMatcherConfig } from "../../notifications/registry";
import { buildMatcherLine, ProcessActionHeader } from "../components";
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
        `${theme.fg("success", `appended ${applied.length}`)}; ${count} active`,
        theme,
      ),
    );
  } else if (mode === "replace") {
    container.addChild(
      buildField(
        "watches",
        `${theme.fg("accent", `replaced ${before.length} with ${applied.length}`)}; ${count} active`,
        theme,
      ),
    );
  } else if (mode === "remove") {
    const removed = before.length - count;
    container.addChild(
      buildField(
        "watches",
        `${theme.fg("error", `removed ${removed}`)}; ${count} active`,
        theme,
      ),
    );
  } else if (mode === "clear") {
    container.addChild(
      buildField(
        "watches",
        `${theme.fg("error", `cleared ${before.length}`)}; ${count} active`,
        theme,
      ),
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

  if (mode === "append") {
    for (const matcher of applied) {
      container.addChild(
        buildMatcherLine(matcher, theme, theme.fg("success", "+ ")),
      );
    }
  }

  if (mode === "replace") {
    for (const matcher of before) {
      container.addChild(
        buildMatcherLine(matcher, theme, theme.fg("error", "- ")),
      );
    }
    for (const matcher of details.watches.items) {
      container.addChild(
        buildMatcherLine(matcher, theme, theme.fg("success", "+ ")),
      );
    }
  }

  if (mode === "remove") {
    for (const matcher of findRemovedMatchers(before, details.watches.items)) {
      container.addChild(
        buildMatcherLine(matcher, theme, theme.fg("error", "- ")),
      );
    }
  }

  if (mode === "clear") {
    for (const matcher of before) {
      container.addChild(
        buildMatcherLine(matcher, theme, theme.fg("error", "- ")),
      );
    }
  }

  return container;
}

export function findRemovedMatchers(
  before: LogMatcherConfig[],
  after: LogMatcherConfig[],
): LogMatcherConfig[] {
  const remaining = new Map<string, number>();
  for (const matcher of after) {
    const key = matcherKey(matcher);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  return before.filter((matcher) => {
    const key = matcherKey(matcher);
    const count = remaining.get(key) ?? 0;
    if (count === 0) return true;
    remaining.set(key, count - 1);
    return false;
  });
}

function matcherKey(matcher: LogMatcherConfig): string {
  return JSON.stringify([
    matcher.pattern,
    matcher.mode ?? "literal",
    matcher.stream ?? "both",
    matcher.repeat ?? false,
    matcher.on ?? "turn",
  ]);
}
