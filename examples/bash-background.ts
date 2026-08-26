/**
 * Example Bash tool override for Pi.
 *
 * Copy this file to ~/.pi/agent/extensions/bash-background.ts. It requires a
 * pi-processes version that provides the `processes:command:adopt` channel.
 *
 * - Press ctrl+shift+b to move a running Bash command to pi-processes.
 * - A tool timeout moves the command instead of stopping it.
 * - A command with no timeout moves after AUTO_BACKGROUND_MS.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type ExtensionAPI,
  getShellConfig,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const ADOPT_CHANNEL = "processes:command:adopt";
const AUTO_BACKGROUND_MS = 120_000;
const MAX_CAPTURED_BYTES = 8 * 1024 * 1024;
const RESULT_TAIL_CHARS = 4_000;

const parameters = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Time limit in seconds. At the limit, the command moves to the background.",
    }),
  ),
});

type BackgroundReason = "user" | "timeout" | "auto";

interface AdoptResult {
  ok: boolean;
  info?: { id: string; name: string; pid: number };
  error?: string;
}

interface RunningCommand {
  background: (reason: BackgroundReason) => void;
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

export default function bashBackground(pi: ExtensionAPI) {
  const running = new Set<RunningCommand>();

  pi.registerShortcut("ctrl+shift+b", {
    description: "Move the running Bash command to the background",
    handler: async (ctx) => {
      if (running.size === 0) {
        ctx.ui.notify("No Bash command is running.", "info");
        return;
      }
      for (const command of running) command.background("user");
    },
  });

  pi.registerTool({
    name: "bash",
    label: "bash",
    description:
      "Execute a Bash command. A long command can move to pi-processes when the user presses ctrl+shift+b, when its timeout expires, or after two minutes without a timeout.",
    parameters,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { command, timeout } = params;
      const cwd = ctx.cwd;
      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }
      if (signal?.aborted) throw new Error("Command aborted");

      // Resolve shell like pi's native bash tool (handles NixOS etc.).
      const shellConfig = getShellConfig();
      const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
        cwd,
        env: process.env,
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

        const cleanup = () => {
          settled = true;
          running.delete(active);
          if (backgroundTimer) clearTimeout(backgroundTimer);
          signal?.removeEventListener("abort", onAbort);
          child.stdout?.off("data", onStdout);
          child.stderr?.off("data", onStderr);
          child.off("close", onClose);
          child.off("error", onError);
        };

        const combinedTail = () => {
          const out = stdoutBuf.tail();
          const err = stderrBuf.tail();
          if (out && err) return `${out}\n${err}`;
          return out || err;
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

        const background = (reason: BackgroundReason) => {
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
            child.stdout?.on("data", onStdout);
            child.stderr?.on("data", onStderr);
            if (reason !== "timeout") return;

            stopProcessGroup(child.pid);
            cleanup();
            fail(
              `Command timed out and background handover failed: ${result?.error ?? "no adopt listener"}`,
            );
            return;
          }

          cleanup();
          const { id, name, pid } = result.info;
          const tail = combinedTail();
          const note =
            `Command moved to background after ${elapsedSeconds(startedAt)}s (${reason}). ` +
            `It is still running as process ${id} ("${name}", pid ${pid}). ` +
            `Use the process tool to read output or stop it.`;
          resolve({
            content: [
              { type: "text", text: `${tail ? `${tail}\n\n` : ""}${note}` },
            ],
            details: { backgrounded: true, processId: id, reason },
          });
        };

        const active: RunningCommand = { background };
        running.add(active);
        child.stdout?.on("data", onStdout);
        child.stderr?.on("data", onStderr);
        child.on("close", onClose);
        child.on("error", onError);
        signal?.addEventListener("abort", onAbort, { once: true });

        if (timeout !== undefined && Number.isFinite(timeout) && timeout > 0) {
          backgroundTimer = setTimeout(
            () => background("timeout"),
            timeout * 1000,
          );
        } else {
          backgroundTimer = setTimeout(
            () => background("auto"),
            AUTO_BACKGROUND_MS,
          );
        }
      });
    },
  });
}
