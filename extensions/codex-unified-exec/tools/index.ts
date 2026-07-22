/**
 * Tool surface for codex-unified-exec: exec_command and write_stdin.
 *
 * Schemas + descriptions are ported verbatim from codex's tool specs
 * (codex-rs/core/src/tools/handlers/shell_spec.rs). The handlers spawn / poll
 * sessions through the SessionManager (session.ts), which wraps a
 * pi-processes ProcessManager with the codex HeadTailBuffer +
 * collectOutputUntilDeadline model and returns a codex ExecCommandToolOutput
 * formatted by render.ts.
 *
 * Omitted from codex (no pi equivalents): the approval/sandbox params (login,
 * sandbox_permissions, additional_permissions, justification, prefix_rule,
 * environment_id). `tty` is accepted for surface-faithfulness but this port is
 * pipe-only; tty:true falls back to pipes until PTY support lands.
 */

import {
  type AgentToolResult,
  defineTool,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import type { ExecCommandOutput } from "../render";
import { formatResponseText } from "../render";
import type {
  ExecCommandRequest,
  SessionManager,
  WriteStdinRequest,
} from "../session";

// exec_command -------------------------------------------------------------

export const ExecCommandParams = Type.Object({
  cmd: Type.String({ description: "Shell command to execute." }),
  workdir: Type.Optional(
    Type.String({
      description:
        "Working directory for the command. Defaults to the agent's current working directory.",
    }),
  ),
  tty: Type.Optional(
    Type.Boolean({
      description:
        "True allocates a PTY for the command; false or omitted uses plain pipes.",
    }),
  ),
  yield_time_ms: Type.Optional(
    Type.Number({
      description:
        "Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms.",
    }),
  ),
  max_output_tokens: Type.Optional(
    Type.Number({
      description:
        "Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.",
    }),
  ),
  shell: Type.Optional(
    Type.String({
      description:
        "Shell binary to launch. Defaults to the user's default shell.",
    }),
  ),
});

export type ExecCommandParamsType = Static<typeof ExecCommandParams>;

// write_stdin ---------------------------------------------------------------

export const WriteStdinParams = Type.Object({
  session_id: Type.Number({
    description: "Identifier of the running unified exec session.",
  }),
  chars: Type.Optional(
    Type.String({
      description:
        "Bytes to write to stdin. Defaults to empty, which polls without writing.",
    }),
  ),
  yield_time_ms: Type.Optional(
    Type.Number({
      description:
        "Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms; empty polls wait 5000-300000 ms by default.",
    }),
  ),
  max_output_tokens: Type.Optional(
    Type.Number({
      description:
        "Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy.",
    }),
  ),
});

export type WriteStdinParamsType = Static<typeof WriteStdinParams>;

// Tool result details (lightweight; no raw Buffer, no full output text) ------

export interface CodexExecDetails {
  kind: "exec_command" | "write_stdin";
  chunkId: string;
  wallTimeSeconds: number;
  exitCode: number | null;
  sessionId: number | null;
  originalTokenCount: number;
  outputOmittedBytes: number | null;
}

function toDetails(
  kind: CodexExecDetails["kind"],
  out: ExecCommandOutput,
): CodexExecDetails {
  return {
    kind,
    chunkId: out.chunkId,
    wallTimeSeconds: out.wallTimeMs / 1000,
    exitCode: out.exitCode,
    sessionId: out.processId,
    originalTokenCount: out.originalTokenCount ?? 0,
    outputOmittedBytes: out.outputOmittedBytes,
  };
}

/**
 * Register the exec_command and write_stdin tools against a SessionManager.
 */
export function registerCodexExecTools(
  pi: ExtensionAPI,
  sessions: SessionManager,
): void {
  pi.registerTool(
    defineTool({
      name: "exec_command",
      label: "Exec command",
      description:
        "Runs a command in a PTY, returning output or a session ID for ongoing interaction.",
      promptSnippet:
        "Run a shell command; returns output or a session ID to continue an interactive process.",
      parameters: ExecCommandParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const req: ExecCommandRequest = {
          cmd: params.cmd,
          workdir: params.workdir,
          tty: params.tty,
          yield_time_ms: params.yield_time_ms,
          max_output_tokens: params.max_output_tokens,
          shell: params.shell,
          cwd: ctx.cwd,
        };
        const out = await sessions.execCommand(req);
        const text = formatResponseText(out);
        const details = toDetails("exec_command", out);
        return {
          content: [{ type: "text", text }],
          details,
        } satisfies AgentToolResult<CodexExecDetails>;
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "write_stdin",
      label: "Write stdin",
      description:
        "Writes characters to an existing unified exec session and returns recent output.",
      promptSnippet:
        "Send input to or poll a running exec_command session; returns recent output.",
      parameters: WriteStdinParams,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const req: WriteStdinRequest = {
          session_id: params.session_id,
          chars: params.chars,
          yield_time_ms: params.yield_time_ms,
          max_output_tokens: params.max_output_tokens,
        };
        const out = await sessions.writeStdin(req);
        const text = formatResponseText(out);
        const details = toDetails("write_stdin", out);
        return {
          content: [{ type: "text", text }],
          details,
        } satisfies AgentToolResult<CodexExecDetails>;
      },
    }),
  );
}
