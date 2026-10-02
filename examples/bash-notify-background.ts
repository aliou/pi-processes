/**
 * Example Bash tool override for Pi.
 *
 * Copy this file to ~/.pi/agent/extensions/bash-notify-background.ts. It
 * requires a pi-processes version that provides the `processes:command:adopt`
 * channel.
 *
 * The tool mirrors pi's native bash tool: same parameters (`command`,
 * `timeout`) and the same output streaming. The only difference is what a
 * timeout does. The native tool kills the process tree and fails. This one
 * hands the running command to pi-processes and returns the background
 * process id in the result so the agent can keep tracking the long-running job.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type ExtensionAPI,
  getShellConfig,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const ADOPT_CHANNEL = "processes:command:adopt";
const MAX_CAPTURED_BYTES = 8 * 1024 * 1024;
const RESULT_TAIL_CHARS = 4_000;

const parameters = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout: Type.Optional(
    Type.Number({
      description: "Timeout in seconds (optional, no default timeout)",
    }),
  ),
});

interface AdoptResult {
  ok: boolean;
  info?: { id: string; name: string; pid: number };
  error?: string;
}

class OutputBuffer {
  private chunks: Buffer[] = [];
  private byteLength = 0;

  append(data: Buffer): void {
    this.chunks.push(data);
    this.byteLength += data.length;
    while (this.byteLength > MAX_CAPTURED_BYTES && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      if (dropped) this.byteLength -= dropped.length;
    }
  }

  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }

  tail(): string {
    const text = this.bytes().toString("utf8").trim();
    if (text.length <= RESULT_TAIL_CHARS) return text;
    return `[...output truncated...]\n${text.slice(-RESULT_TAIL_CHARS)}`;
  }
}

function stopProcessGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch (_error) {
      void _error; // The process already ended.
    }
  }
}

function processName(command: string): string {
  const executable = command.trim().split(/\s+/)[0]?.split("/").pop() ?? "cmd";
  return `bg-${executable.slice(0, 20)}-${Date.now().toString(36).slice(-4)}`;
}

function elapsedSeconds(startedAt: number): number {
  return Math.round((Date.now() - startedAt) / 1000);
}

function buildEnv(ctx: {
  sessionManager: {
    getSessionId(): string;
    getSessionFile?(): string | undefined;
  };
  model?: { provider: string; id: string } | undefined;
  thinkingLevel?: string;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PI_SESSION_ID;
  delete env.PI_SESSION_FILE;
  delete env.PI_PROVIDER;
  delete env.PI_MODEL;
  delete env.PI_REASONING_LEVEL;
  env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
  const sessionFile = ctx.sessionManager.getSessionFile?.();
  if (sessionFile) env.PI_SESSION_FILE = sessionFile;
  if (ctx.model) {
    env.PI_PROVIDER = ctx.model.provider;
    env.PI_MODEL = ctx.model.id;
  }
  if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;
  return env;
}

export default function bashNotifyBackground(pi: ExtensionAPI) {
  pi.registerTool({
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds; when the timeout fires the command keeps running in pi-processes instead of being killed.",
    parameters,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { command, timeout } = params;
      const cwd = ctx.cwd;
      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }
      if (signal?.aborted) throw new Error("Command aborted");

      const shellConfig = getShellConfig();
      const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
        cwd,
        env: buildEnv(ctx),
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
      const stdoutBuf = new OutputBuffer();
      const stderrBuf = new OutputBuffer();
      const startedAt = Date.now();

      return await new Promise((resolve, reject) => {
        let settled = false;
        let backgroundTimer: NodeJS.Timeout | undefined;

        const onStdout = (data: Buffer) => {
          stdoutBuf.append(data);
          onUpdate?.({
            content: [{ type: "text", text: stdoutBuf.tail() }],
            details: {},
          });
        };

        const onStderr = (data: Buffer) => {
          stderrBuf.append(data);
          onUpdate?.({
            content: [{ type: "text", text: stderrBuf.tail() }],
            details: {},
          });
        };

        const combinedTail = () => {
          const out = stdoutBuf.tail();
          const err = stderrBuf.tail();
          if (out && err) return `${out}\n${err}`;
          return out || err;
        };

        const cleanup = () => {
          settled = true;
          if (backgroundTimer) clearTimeout(backgroundTimer);
          signal?.removeEventListener("abort", onAbort);
          child.stdout?.off("data", onStdout);
          child.stderr?.off("data", onStderr);
          child.off("close", onClose);
          child.off("error", onError);
        };

        const fail = (message: string) => {
          const tail = combinedTail();
          reject(new Error(`${tail ? `${tail}\n\n` : ""}${message}`));
        };

        const onAbort = () => {
          if (settled) return;
          if (child.pid) stopProcessGroup(child.pid);
          cleanup();
          fail("Command aborted");
        };

        const onClose = (
          code: number | null,
          signalCode: NodeJS.Signals | null,
        ) => {
          if (settled) return;
          cleanup();
          if (signalCode) {
            fail(`Command terminated by ${signalCode}`);
          } else if (code !== 0 && code !== null) {
            fail(`Command exited with code ${code}`);
          } else {
            resolve({
              content: [
                { type: "text", text: combinedTail() || "(no output)" },
              ],
              details: {},
            });
          }
        };

        const onError = (error: Error) => {
          if (settled) return;
          cleanup();
          reject(error);
        };

        const background = () => {
          if (settled || !child.pid) return;

          // Stop reading first. The event bus and reply are synchronous, so
          // pi-processes installs its listeners before this call returns.
          child.stdout?.off("data", onStdout);
          child.stderr?.off("data", onStderr);

          let result: AdoptResult | undefined;
          pi.events.emit(ADOPT_CHANNEL, {
            name: processName(command),
            command,
            cwd,
            child: child as ChildProcess,
            initialStdout: stdoutBuf.bytes(),
            initialStderr: stderrBuf.bytes(),
            startTime: startedAt,
            reply: (reply: AdoptResult) => {
              result = reply;
            },
          });

          if (!result?.ok || !result.info) {
            stopProcessGroup(child.pid);
            cleanup();
            fail(
              `Command timed out and background handover failed: ${result?.error ?? "no adopt listener"}`,
            );
            return;
          }

          cleanup();
          const { id, name } = result.info;
          const tail = combinedTail();
          const note =
            `Command moved to background after ${elapsedSeconds(startedAt)}s (timeout). ` +
            `It is still running as process ${id} ("${name}"). ` +
            `Use the process tool to read output or stop it.`;
          resolve({
            content: [
              { type: "text", text: `${tail ? `${tail}\n\n` : ""}${note}` },
            ],
            details: { backgrounded: true, processId: id },
          });
        };

        child.stdout?.on("data", onStdout);
        child.stderr?.on("data", onStderr);
        child.on("close", onClose);
        child.on("error", onError);
        signal?.addEventListener("abort", onAbort, { once: true });

        if (timeout !== undefined && Number.isFinite(timeout) && timeout > 0) {
          backgroundTimer = setTimeout(background, timeout * 1000);
        }
      });
    },
  });
}
