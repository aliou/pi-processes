/**
 * Background command blocker.
 *
 * Listens for bash tool calls and blocks commands that contain
 * shell background patterns (trailing &, nohup, disown, setsid).
 *
 * Uses @aliou/sh to parse commands into an AST and walk all
 * SimpleCommand nodes, checking for:
 * - Statement.background (trailing &)
 * - Command name matching nohup/disown/setsid
 *
 * Registered only when config.interception.blockBackgroundCommands is enabled.
 * Returns a blocking reason that tells the agent to use the process tool instead.
 */

import type {
  Command,
  Program,
  SimpleCommand,
  Statement,
  Word,
} from "@aliou/sh";
import { parse } from "@aliou/sh";
import type {
  BashToolCallEvent,
  ExtensionAPI,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { t } from "../i18n";

const BACKGROUND_KEYWORDS = new Set(["nohup", "disown", "setsid"]);

/**
 * Extract the literal command name from a Word node.
 * Returns the value of the first Literal part, or undefined if
 * the word starts with a non-literal (e.g., variable expansion).
 */
function getCommandName(word: Word): string | undefined {
  const firstPart = word.parts?.[0];
  if (firstPart?.type === "Literal") {
    return firstPart.value;
  }
  return undefined;
}

/**
 * Check if a SimpleCommand's name matches a background keyword.
 */
function isBackgroundSimpleCommand(cmd: SimpleCommand): boolean {
  const firstName = cmd.words?.[0] ? getCommandName(cmd.words[0]) : undefined;
  return firstName !== undefined && BACKGROUND_KEYWORDS.has(firstName);
}

/**
 * Recursively walk a Command AST, returning true if any branch
 * contains a background pattern (trailing & or background keyword).
 */
function walkCommand(command: Command, isBg: { value: boolean }): void {
  switch (command.type) {
    case "SimpleCommand":
      if (isBackgroundSimpleCommand(command)) {
        isBg.value = true;
      }
      break;

    case "Pipeline":
      for (const stmt of command.commands ?? []) {
        walkStatement(stmt, isBg);
        if (isBg.value) return;
      }
      break;

    case "Logical":
      walkStatement(command.left, isBg);
      if (isBg.value) return;
      walkStatement(command.right, isBg);
      break;

    case "Subshell":
    case "Block":
      for (const stmt of command.body ?? []) {
        walkStatement(stmt, isBg);
        if (isBg.value) return;
      }
      break;

    case "IfClause":
      for (const stmt of command.cond ?? []) {
        walkStatement(stmt, isBg);
        if (isBg.value) return;
      }
      for (const stmt of command.then ?? []) {
        walkStatement(stmt, isBg);
        if (isBg.value) return;
      }
      for (const stmt of command.else ?? []) {
        walkStatement(stmt, isBg);
        if (isBg.value) return;
      }
      break;

    case "WhileClause":
    case "ForClause":
    case "SelectClause":
    case "CStyleLoop":
      for (const stmt of command.body ?? []) {
        walkStatement(stmt, isBg);
        if (isBg.value) return;
      }
      break;

    case "FunctionDecl":
      for (const stmt of command.body ?? []) {
        walkStatement(stmt, isBg);
        if (isBg.value) return;
      }
      break;

    case "CaseClause":
      for (const item of command.items ?? []) {
        for (const stmt of item.body ?? []) {
          walkStatement(stmt, isBg);
          if (isBg.value) return;
        }
      }
      break;

    default:
      // TimeClause, TestClause, ArithCmd, CoprocClause, DeclClause, LetClause:
      // these don't carry SimpleCommands that are background indicators.
      break;
  }
}

function walkStatement(stmt: Statement, isBg: { value: boolean }): void {
  if (stmt.background) {
    isBg.value = true;
    return;
  }
  if (stmt.command) {
    walkCommand(stmt.command, isBg);
  }
}

/**
 * Check if a command string contains background execution patterns.
 * Returns true if the command should be blocked.
 *
 * Uses @aliou/sh to parse the command into an AST. If the command
 * cannot be parsed (syntax error), falls back to a simple regex
 * heuristic for trailing &.
 */
export function isBackgroundCommand(command: string): boolean {
  let program: Program;

  try {
    const result = parse(command);
    program = result.ast;
  } catch {
    // Fallback: if the command can't be parsed (syntax error),
    // use a simple regex heuristic for trailing &.
    return /\s*&\s*$/.test(command);
  }

  const isBg = { value: false };

  for (const stmt of program.body ?? []) {
    walkStatement(stmt, isBg);
    if (isBg.value) return true;
  }

  return false;
}

/**
 * Register the background command blocker on the tool_call event.
 *
 * The blocker only activates when the provided isEnabled callback returns true.
 * pi.on() does not return a disposer, so cleanup is handled by session_shutdown.
 */
export function registerBackgroundBlocker(
  pi: ExtensionAPI,
  isEnabled: () => boolean,
): void {
  pi.on("tool_call", (event) => {
    if (!isEnabled()) return;

    if (event.toolName !== "bash") return;

    const bashEvent = event as BashToolCallEvent;
    const command = bashEvent.input.command;

    if (isBackgroundCommand(command)) {
      return {
        block: true,
        reason: t("process.blocker.background_command"),
      } satisfies ToolCallEventResult;
    }
  });
}
