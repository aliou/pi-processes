/**
 * Example: transform background bash commands into pi-processes calls.
 *
 * Copy this file to ~/.pi/agent/extensions/bash-to-process.ts. Requires
 * @aliou/pi-processes (the core extension must be loaded) and @aliou/sh.
 *
 * Instead of blocking background bash commands like the built-in
 * background-blocker hook, this extension moves them to the process tool
 * automatically:
 *
 * - The agent calls `bash` with `node server.js &` (or nohup/setsid/disown).
 * - The command is parsed with @aliou/sh into an AST.
 * - If every top-level statement is a background command, each one is
 *   extracted using source offsets (trailing `&` cut, nohup/setsid/disown
 *   prefix removed, output redirects dropped — pi-processes already logs
 *   stdout/stderr per process) and started as a managed process via the
 *   `processes:command:start` protocol channel.
 * - The bash call itself is blocked with a reason naming the started
 *   process ids, so the model sees the move in the tool result.
 *
 * Limits:
 * - A `tool_call` handler cannot rewrite one tool call into another; it can
 *   only mutate the input in place or block. Moving the command to
 *   pi-processes and blocking the bash call is the cleanest transform.
 * - Mixed commands (`make build && node server.js &`) are blocked with an
 *   instruction to split them manually. Only fully-background command
 *   lines are moved automatically.
 *
 * Disable the built-in blocker when using this example
 * (/ps:settings -> interception.blockBackgroundCommands = false) so the two
 * hooks don't both answer the same tool call.
 */

import type { Command, SimpleCommand, Statement, Word } from "@aliou/sh";
import { parse } from "@aliou/sh";
import type {
  BashToolCallEvent,
  ExtensionAPI,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

const START_CHANNEL = "processes:command:start";
const BACKGROUND_KEYWORDS = new Set(["nohup", "setsid", "disown"]);

interface StartResult {
  ok: boolean;
  process?: { id: string; name: string; pid: number };
  error?: string;
}

interface BackgroundSegment {
  /** Clean command text to run under pi-processes (no `&`, no prefix). */
  command: string;
  /** Suggested process name. */
  name: string;
}

type Classification =
  | { kind: "foreground" }
  | { kind: "mixed" }
  | { kind: "background"; segments: BackgroundSegment[] };

// --- AST helpers -------------------------------------------------------------

/** Walk to the leftmost SimpleCommand inside Logical/Pipeline chains. */
function leftmostSimpleCommand(stmt: Statement): SimpleCommand | null {
  let node: Command | Statement = stmt;
  for (;;) {
    if (node.type === "Statement") {
      if (!node.command) return null;
      node = node.command;
      continue;
    }
    if (node.type === "SimpleCommand") return node;
    if (node.type === "Pipeline") {
      const first: Statement | undefined = node.commands?.[0];
      if (!first) return null;
      node = first;
      continue;
    }
    if (node.type === "Logical") {
      if (!node.left) return null;
      node = node.left;
      continue;
    }
    return null;
  }
}

// --- Redirect stripping ------------------------------------------------------

// pi-processes captures stdout/stderr per process (stdout.log, stderr.log,
// combined.log), so output redirects in the original command are dropped:
// `> log 2>&1` would only duplicate what the manager already records, and
// `>/dev/null 2>&1` would hide all output from the process tool. `< /dev/null`
// is part of the same detach ritual and is dropped too: pi-processes provides
// stdin itself.
const OUTPUT_REDIRECT_OPS = new Set([">", ">>", ">&", "&>", "&>>"]);

interface SourceRange {
  start: number;
  end: number;
}

/** True for a `/dev/null` literal target. */
function isDevNullTarget(word: unknown): boolean {
  const target = word as { parts?: { type?: string; value?: string }[] };
  const part = target?.parts?.[0];
  return part?.type === "Literal" && part.value === "/dev/null";
}

/**
 * Collect source ranges of all removable redirects anywhere in the AST:
 * every output redirect, plus input redirects from /dev/null.
 */
function collectOutputRedirects(node: unknown, ranges: SourceRange[]): void {
  if (!node || typeof node !== "object") return;
  const obj = node as {
    type?: string;
    op?: string;
    target?: unknown;
    pos?: { offset: number };
    end?: { offset: number };
  };
  if (obj.type === "Redirect") {
    if (!obj.pos || !obj.end) return;
    const isOutput = obj.op !== undefined && OUTPUT_REDIRECT_OPS.has(obj.op);
    const isDevNullInput = obj.op === "<" && isDevNullTarget(obj.target);
    if (isOutput || isDevNullInput) {
      ranges.push({ start: obj.pos.offset, end: obj.end.offset });
    }
    return;
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) collectOutputRedirects(item, ranges);
    } else {
      collectOutputRedirects(value, ranges);
    }
  }
}

// --- Segment extraction ------------------------------------------------------

function wordIsKeyword(word: Word): boolean {
  const first = word.parts?.[0];
  return first?.type === "Literal" && BACKGROUND_KEYWORDS.has(first.value);
}

/** Name a process after the first literal word of its command. */
function processName(command: string): string {
  try {
    const { ast } = parse(command);
    for (const stmt of ast.body ?? []) {
      const part = leftmostSimpleCommand(stmt)?.words?.[0]?.parts?.[0];
      if (part?.type === "Literal") {
        const base = part.value.split("/").pop() ?? "bg";
        const clean = base.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 24);
        if (clean) return `${clean}-${Date.now().toString(36).slice(-4)}`;
      }
      break;
    }
  } catch (error) {
    void error; // Fall through to the generic name.
  }
  return `bg-${Date.now().toString(36).slice(-4)}`;
}

/**
 * Turn one background Statement into a clean command string, using source
 * offsets: the trailing `&` is cut, leading nohup/setsid/disown words and
 * every output redirect (or `< /dev/null`) are removed by their source
 * ranges, so quoting and other input redirects survive intact.
 */
function extractSegment(
  source: string,
  stmt: Statement,
): BackgroundSegment | null {
  if (stmt.pos == null || stmt.end == null) return null;
  const base = stmt.pos.offset;
  const text = source.slice(base, stmt.end.offset).replace(/&\s*$/, "");

  const removals: SourceRange[] = [];
  collectOutputRedirects(stmt, removals);

  // Strip consecutive leading keyword words (nohup, setsid, disown), e.g.
  // `setsid nohup build.sh &` leaves just `build.sh`.
  const first = leftmostSimpleCommand(stmt);
  for (const word of first?.words ?? []) {
    if (!wordIsKeyword(word)) break;
    if (word.pos && word.end) {
      removals.push({ start: word.pos.offset, end: word.end.offset });
    }
  }

  // Cut ranges back to front so earlier offsets stay valid.
  let cleaned = text;
  for (const range of removals.sort((a, b) => b.start - a.start)) {
    cleaned =
      cleaned.slice(0, range.start - base) + cleaned.slice(range.end - base);
  }

  const command = cleaned.trim();
  if (!command) return null;
  return { command, name: processName(command) };
}

/**
 * Classify a bash command line.
 * - foreground: no background statements, let bash run it.
 * - mixed: some statements backgrounded, some not — block for a manual split.
 * - background: every statement is background — move all to pi-processes.
 */
function classify(source: string): Classification {
  let body: Statement[];
  try {
    body = parse(source).ast.body ?? [];
  } catch {
    // Unparseable: fall back to a trailing-& heuristic on the raw text.
    if (!/\s*&\s*$/.test(source)) return { kind: "foreground" };
    const command = source.replace(/&\s*$/, "").trim();
    if (!command) return { kind: "foreground" };
    return {
      kind: "background",
      segments: [{ command, name: processName(command) }],
    };
  }

  const segments: BackgroundSegment[] = [];
  let sawBackground = false;

  for (const stmt of body) {
    if (!stmt.background) continue;
    sawBackground = true;
    const segment = extractSegment(source, stmt);
    if (segment) segments.push(segment);
  }

  if (!sawBackground) return { kind: "foreground" };
  if (segments.length !== body.length) return { kind: "mixed" };
  return { kind: "background", segments };
}

// --- Extension ---------------------------------------------------------------

export default function bashToProcess(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;

    const { input } = event as BashToolCallEvent;
    const result = classify(input.command);

    if (result.kind === "foreground") return;

    if (result.kind === "mixed") {
      return {
        block: true,
        reason:
          "This command mixes background and foreground work. Run the " +
          'background part with the process tool (action="start") and the ' +
          "foreground part with bash.",
      } satisfies ToolCallEventResult;
    }

    // Move every segment to pi-processes. The reply is synchronous: if the
    // core extension is not loaded, no listener fires and `start` stays empty.
    const started: { id: string; name: string; command: string }[] = [];
    for (const segment of result.segments) {
      let start: StartResult | undefined;
      pi.events.emit(START_CHANNEL, {
        name: segment.name,
        command: segment.command,
        reply: (value: StartResult) => {
          start = value;
        },
      });

      if (!start) {
        return {
          block: true,
          reason:
            `pi-processes did not answer ${START_CHANNEL}. ` +
            "Load @aliou/pi-processes, or run this command without a " +
            "background operator.",
        } satisfies ToolCallEventResult;
      }
      if (!start.ok || !start.process) {
        return {
          block: true,
          reason:
            `Failed to background "${segment.command}": ${start.error}. ` +
            "Run it in bash without a background operator instead.",
        } satisfies ToolCallEventResult;
      }
      started.push({
        id: start.process.id,
        name: start.process.name,
        command: segment.command,
      });
    }

    const lines = started.map((s) => `- ${s.id} ("${s.name}"): ${s.command}`);
    return {
      block: true,
      reason:
        "The bash call was transformed into pi-processes starts; nothing " +
        "ran in bash:\n" +
        lines.join("\n") +
        "\nOutput redirects were dropped: pi-processes records stdout and " +
        "stderr per process. Use the process tool to check output or stop " +
        "them.",
    } satisfies ToolCallEventResult;
  });
}
