/**
 * Tool surface for codex-unified-exec: exec_command and write_stdin schemas,
 * ported from codex's exec_command/write_stdin tool specs
 * (codex-rs/core/src/tools/handlers/shell_spec.rs).
 *
 * The builders + handlers land in chunk 2 (session wrapper around the
 * ProcessManager + HeadTailBuffer + collectOutputUntilDeadline). For chunk 1
 * the schemas are exported and `registerCodexExecTools` is a no-op stub so the
 * config gate is coherent.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

import type { ProcessManager } from "../../../src/manager";

// exec_command -------------------------------------------------------------
// Codex ships cmd, workdir, tty, yield_time_ms, max_output_tokens, shell by
// default. The approval/sandbox params (login, sandbox_permissions,
// additional_permissions, justification, prefix_rule, environment_id) are
// omitted: pi-processes has no sandbox/approval subsystem, so they would be
// silent no-ops. tty is accepted for surface-faithfulness but this port runs
// pipe-only; tty:true falls back to pipes until PTY support lands.

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

/**
 * Register the exec_command and write_stdin tools.
 *
 * Chunk 2 will wire these to a session wrapper around `manager` plus
 * HeadTailBuffer and collectOutputUntilDeadline. For now this is a no-op so the
 * config gate is coherent when the extension is enabled.
 */
export function registerCodexExecTools(
  pi: ExtensionAPI,
  manager: ProcessManager,
): void {
  void pi;
  void manager;
}
