/**
 * Example extension: Codex-style unified exec (`exec_command` + `write_stdin`).
 *
 * Copy this file to ~/.pi/agent/extensions/codex-exec.ts. It requires the core
 * pi-processes extension: commands that outlive their yield time are handed
 * over through the `processes:command:adopt` channel, stopped through
 * `processes:command:kill`, and streamed through `processes:logs:*`, so they
 * are visible in /ps, logged, and killed at session shutdown.
 *
 * Implements the tool pair described in
 * https://github.com/aliou/pi-processes/issues/111 on top of the existing
 * process manager:
 *
 * - `exec_command` runs a command and blocks up to `yield_time_ms` (default
 *   10s, clamped to 250ms–30s) while collecting output. A command that exits
 *   in time returns its output and exit code directly. A command that is
 *   still running is adopted by pi-processes and returns a numeric session
 *   id.
 * - `write_stdin` talks to a session: non-empty `chars` are written to the
 *   process stdin, empty `chars` polls for new output, and `\x03` sends
 *   Ctrl-C as a SIGINT to the process group. Output is returned as deltas:
 *   only what was produced since the previous call. `yield_time_ms` follows
 *   Codex semantics: non-empty writes wait up to 30s (default 250ms), empty
 *   polls wait up to 300s (default 5s).
 *
 * The parameters mirror Codex's tool surface (cmd, workdir, shell, login,
 * yield_time_ms, max_output_tokens, tty); `tty: true` is rejected because
 * pipe-spawned processes have no PTY here.
 * - The built-in `bash` tool is disabled on session start so models trained
 *   on Codex's tool surface use the pair instead. The `process` tool stays
 *   active: its exit notifications are the alternative to polling.
 *
 * Known limitation (see issue #111): pipe-spawned processes have no
 * controlling terminal, and a non-interactive shell ignores SIGINT for some
 * commands. The kill path escalates SIGINT → SIGKILL, which covers the
 * common case.
 */
import type { ChildProcess } from "node:child_process";
// biome-ignore lint/plugin/@aliou/biome-plugins/pi-no-node-exec: long-lived streaming process that pi.exec() does not support
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  type ExtensionAPI,
  getShellConfig,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const ADOPT_CHANNEL = "processes:command:adopt";
const KILL_CHANNEL = "processes:command:kill";
const LOGS_SUBSCRIBE_CHANNEL = "processes:logs:subscribe";
const LOGS_UNSUBSCRIBE_CHANNEL = "processes:logs:unsubscribe";
const LOGS_CHUNK_CHANNEL = "processes:logs:chunk";

const DEFAULT_YIELD_MS = 10_000;
const MIN_YIELD_MS = 250;
const MAX_YIELD_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const BYTES_PER_TOKEN = 4;
// Codex collects ~250ms after a stdin write before replying.
const WRITE_SETTLE_MS = 250;
const WRITE_MAX_MS = 30_000;
const POLL_WAIT_MS = 5_000;
const POLL_MAX_MS = 300_000;
// SIGINT grace before the manager escalates to SIGKILL.
const INTERRUPT_TIMEOUT_MS = 1_000;
const MAX_BUFFERED_LINES = 5_000;
const MAX_RAW_BUFFER_BYTES = 8 * 1024 * 1024;

type LogLine = { type: "stdout" | "stderr"; text: string };

interface AdoptResult {
  ok: boolean;
  info?: { id: string; name: string; pid: number };
  error?: string;
}

interface ManagedSession {
  session: ExecSession;
  processId: string;
  subscriberId: string;
}

const sessions = new Map<number, ManagedSession>();
let nextSessionId = 1;
let nextChunkId = 1;

function clampYieldMs(value: number | undefined): number {
  const ms = value ?? DEFAULT_YIELD_MS;
  return Math.min(MAX_YIELD_MS, Math.max(MIN_YIELD_MS, ms));
}

function clampWriteWaitMs(value: number | undefined): number {
  return Math.min(WRITE_MAX_MS, Math.max(0, value ?? WRITE_SETTLE_MS));
}

function clampPollWaitMs(value: number | undefined): number {
  return Math.min(POLL_MAX_MS, Math.max(0, value ?? POLL_WAIT_MS));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Unref so a parked timer never keeps the event loop alive.
    timer.unref?.();
  });
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

function processName(command: string, prefix: string): string {
  const executable = command.trim().split(/\s+/)[0]?.split("/").pop() ?? "cmd";
  return `${prefix}-${executable.slice(0, 20)}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * Collects output for one command. Before adoption the streams are read
 * directly; after adoption delta lines arrive over the logs channel and
 * pre-adoption output is replayed to pi-processes via the adopt payload.
 */
class ExecSession {
  readonly child: ChildProcess;
  readonly lines: LogLine[] = [];
  exited = false;
  exitCode: number | null = null;
  exitSignal: string | null = null;
  private cursor = 0;
  private droppedLines = 0;
  private readonly rawStdout: Buffer[] = [];
  private readonly rawStderr: Buffer[] = [];
  private rawBytes = 0;
  private wake: (() => void) | null = null;

  constructor(child: ChildProcess) {
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      this.appendChunk("stdout", chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.appendChunk("stderr", chunk);
    });
    child.on("close", (code, signal) => {
      this.exited = true;
      this.exitCode = code;
      this.exitSignal = signal;
      this.wakeUp();
    });
  }

  /** Resolve as soon as new output or the close event arrives, or ms elapse. */
  waitForChange(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => done(), ms);
      timer.unref?.();
      const done = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      this.wake = done;
    });
  }

  /** Resolves once the process closed, immediately if it already has. */
  exitOnce(): Promise<void> {
    if (this.exited) return Promise.resolve();
    return new Promise((resolve) => {
      this.child.once("close", () => resolve());
    });
  }

  /** Wait until new output is available, the process exits, or ms elapse. */
  async waitForOutput(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (
      !this.exited &&
      this.cursor >= this.lines.length &&
      Date.now() < deadline
    ) {
      await this.waitForChange(deadline - Date.now());
    }
  }

  /**
   * Stop reading the streams. Call right before handing the child over: the
   * event bus and the adopt reply are synchronous, so pi-processes installs
   * its listeners before this returns and nothing is lost in between.
   */
  detach(): void {
    this.child.stdout?.removeAllListeners("data");
    this.child.stderr?.removeAllListeners("data");
  }

  /** Output produced since the last take, clipped to the token budget. */
  takeOutput(maxTokens: number): { text: string; originalTokens: number } {
    const chunk = this.lines.slice(this.cursor);
    this.cursor = this.lines.length;
    const raw = chunk.map((line) => line.text).join("");
    const originalTokens = Math.ceil(
      Buffer.byteLength(raw, "utf8") / BYTES_PER_TOKEN,
    );

    const notes: string[] = [];
    if (this.droppedLines > 0) {
      notes.push(`[...${this.droppedLines} earlier line(s) dropped...]`);
      this.droppedLines = 0;
    }

    const maxBytes = maxTokens * BYTES_PER_TOKEN;
    const bytes = Buffer.from(raw, "utf8");
    let text = raw;
    if (bytes.length > maxBytes) {
      notes.push(
        `[...${bytes.length - maxBytes} byte(s) truncated, showing the tail...]`,
      );
      text = bytes.subarray(bytes.length - maxBytes).toString("utf8");
    }

    return {
      text: [...notes, text].filter(Boolean).join("\n"),
      originalTokens,
    };
  }

  /** Pre-adoption capture, replayed to pi-processes via the adopt payload. */
  takeRawBuffers(): { stdout: Buffer; stderr: Buffer } {
    const stdout = Buffer.concat(this.rawStdout);
    const stderr = Buffer.concat(this.rawStderr);
    this.rawStdout.length = 0;
    this.rawStderr.length = 0;
    this.rawBytes = 0;
    return { stdout, stderr };
  }

  appendChunk(type: "stdout" | "stderr", chunk: Buffer): void {
    const text = chunk.toString("utf8");
    if (!text) return;
    this.lines.push({ type, text });
    this.rawBytes += chunk.length;
    const raw = type === "stdout" ? this.rawStdout : this.rawStderr;
    raw.push(chunk);
    while (this.rawBytes > MAX_RAW_BUFFER_BYTES && raw.length > 1) {
      const dropped = raw.shift();
      if (dropped) this.rawBytes -= dropped.length;
    }
    this.trim();
    this.wakeUp();
  }

  /** Post-adoption delta lines from the logs channel. */
  appendLines(lines: LogLine[]): void {
    if (lines.length === 0) return;
    this.lines.push(...lines);
    this.trim();
    this.wakeUp();
  }

  private trim(): void {
    const excess = this.lines.length - MAX_BUFFERED_LINES;
    if (excess <= 0) return;
    this.lines.splice(0, excess);
    this.cursor = Math.max(0, this.cursor - excess);
    this.droppedLines += excess;
  }

  private wakeUp(): void {
    const current = this.wake;
    if (!current) return;
    this.wake = null;
    current();
  }
}

function formatExecOutput(options: {
  chunkId: number;
  wallTimeMs: number;
  running: boolean;
  sessionId?: number;
  exitCode: number | null;
  exitSignal: string | null;
  output: string;
  originalTokens: number;
}): string {
  const header: string[] = [];
  header.push(`Chunk ID: ${options.chunkId}`);
  header.push(`Wall time: ${(options.wallTimeMs / 1000).toFixed(1)}s`);
  if (options.running && options.sessionId !== undefined) {
    header.push(`Process running with session ID ${options.sessionId}`);
  } else {
    const code =
      options.exitCode ??
      (options.exitSignal ? `signal ${options.exitSignal}` : "unknown");
    header.push(`Process exited with code ${code}`);
  }
  header.push(`Original token count: ${options.originalTokens}`);
  header.push("Output:");
  return `${header.join("\n")}${options.output ? `\n${options.output}` : ""}`;
}

function spawnSession(
  command: string,
  cwd: string,
  shellPath?: string,
  login = true,
): ExecSession {
  // Without an explicit shell, resolve like pi's native bash tool (handles
  // NixOS etc.); its args already encode the right invocation. With an
  // explicit shell, mirror Codex: login adds -l, then run -c.
  const shellConfig = getShellConfig();
  const shell = shellPath ?? shellConfig.shell;
  const args = shellPath
    ? [...(login ? ["-l"] : []), "-c", command]
    : [...shellConfig.args, command];
  const child = spawn(shell, args, {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  return new ExecSession(child);
}

function adoptProcess(
  pi: ExtensionAPI,
  command: string,
  cwd: string,
  child: ChildProcess,
  initial: { stdout: Buffer; stderr: Buffer },
  startTime: number,
): AdoptResult {
  let result: AdoptResult | undefined;
  pi.events.emit(ADOPT_CHANNEL, {
    name: processName(command, "codex"),
    command,
    cwd,
    child,
    initialStdout: initial.stdout,
    initialStderr: initial.stderr,
    startTime,
    reply: (reply: AdoptResult) => {
      result = reply;
    },
  });
  return (
    result ?? {
      ok: false,
      error: "no adopt listener (is the pi-processes extension loaded?)",
    }
  );
}

function killProcess(
  pi: ExtensionAPI,
  id: string,
  signal: NodeJS.Signals,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs + 2000);
    timer.unref?.();
    pi.events.emit(KILL_CHANNEL, {
      id,
      signal,
      timeoutMs,
      reply: (result: { ok: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result.ok);
      },
    });
  });
}

const execCommandParameters = Type.Object({
  cmd: Type.String({ description: "Shell command to execute." }),
  workdir: Type.Optional(
    Type.String({
      description:
        "Working directory for the command. Defaults to the turn cwd.",
    }),
  ),
  tty: Type.Optional(
    Type.Boolean({
      description:
        "True allocates a PTY for the command; false or omitted uses plain pipes. PTY is not supported here and always errors.",
    }),
  ),
  shell: Type.Optional(
    Type.String({
      description:
        "Shell binary to launch. Defaults to the user's default shell.",
    }),
  ),
  login: Type.Optional(
    Type.Boolean({
      description:
        "True runs the shell with -l/-i semantics; false disables them. Defaults to true.",
    }),
  ),
  yield_time_ms: Type.Optional(
    Type.Number({
      description:
        "Block for at most this many milliseconds (250–30000, default 10000). Still running after that returns a session id.",
    }),
  ),
  max_output_tokens: Type.Optional(
    Type.Number({
      description:
        "Output token budget. Defaults to 10000 tokens (~4 bytes/token).",
    }),
  ),
});

const writeStdinParameters = Type.Object({
  session_id: Type.Number({
    description: "Identifier of the running unified exec session.",
  }),
  chars: Type.String({
    description:
      "Bytes to write to stdin. Defaults to empty, which polls without writing. \\x03 sends Ctrl-C.",
  }),
  yield_time_ms: Type.Optional(
    Type.Number({
      description:
        "Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms; empty polls wait 5000-300000 ms by default.",
    }),
  ),
  max_output_tokens: Type.Optional(
    Type.Number({
      description: "Output budget in tokens (~4 bytes/token, default 10000).",
    }),
  ),
});

function disposeSession(pi: ExtensionAPI, sessionId: number): void {
  const managed = sessions.get(sessionId);
  if (!managed) return;
  sessions.delete(sessionId);
  pi.events.emit(LOGS_UNSUBSCRIBE_CHANNEL, {
    subscriberId: managed.subscriberId,
  });
}

export default function codexExec(pi: ExtensionAPI) {
  const dispatchChunk = (data: unknown) => {
    const payload = data as { subscriberId: string; lines: LogLine[] };
    for (const managed of sessions.values()) {
      if (managed.subscriberId !== payload.subscriberId) continue;
      managed.session.appendLines(payload.lines);
      break;
    }
  };
  const offChunk = pi.events.on(LOGS_CHUNK_CHANNEL, dispatchChunk);
  pi.on("session_start", () => {
    const active = pi.getActiveTools();
    if (active.includes("bash")) {
      pi.setActiveTools(active.filter((name) => name !== "bash"));
    }
  });
  void offChunk; // Session-scoped: stays registered for the whole session.

  pi.registerTool({
    name: "exec_command",
    label: "exec_command",
    description:
      "Run a shell command. Blocks briefly and returns the output and exit code; long-running commands return a numeric session id that write_stdin uses to send input and read further output.",
    parameters: execCommandParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.tty) {
        throw new Error(
          "tty: true is not supported (pipe-spawned processes have no PTY). Omit tty or pass false.",
        );
      }
      const cwd = params.workdir ?? ctx.cwd;
      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }
      if (signal?.aborted) throw new Error("Command aborted");

      const yieldMs = clampYieldMs(params.yield_time_ms);
      const maxTokens = Math.max(
        1,
        Math.round(params.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
      );
      const session = spawnSession(
        params.cmd,
        cwd,
        params.shell,
        params.login ?? true,
      );
      const startedAt = Date.now();
      const chunkId = nextChunkId++;

      await Promise.race([session.exitOnce(), sleep(yieldMs)]);

      if (signal?.aborted && !session.exited) {
        if (session.child.pid) stopProcessGroup(session.child.pid);
        throw new Error("Command aborted");
      }

      if (session.exited) {
        const output = session.takeOutput(maxTokens);
        return {
          content: [
            {
              type: "text",
              text: formatExecOutput({
                chunkId,
                wallTimeMs: Date.now() - startedAt,
                running: false,
                exitCode: session.exitCode,
                exitSignal: session.exitSignal,
                output: output.text,
                originalTokens: output.originalTokens,
              }),
            },
          ],
          details: { chunkId, exitCode: session.exitCode },
        };
      }

      // Still running: hand the child over to pi-processes, then stream the
      // rest over the logs channel. Stop reading before the handover — the
      // event bus and the adopt reply are synchronous.
      session.detach();
      const initial = session.takeRawBuffers();
      const adopt = adoptProcess(
        pi,
        params.cmd,
        cwd,
        session.child,
        initial,
        startedAt,
      );
      if (!adopt.ok || !adopt.info) {
        if (session.child.pid) stopProcessGroup(session.child.pid);
        throw new Error(
          `Background handover failed: ${adopt.error ?? "unknown error"}`,
        );
      }

      const sessionId = nextSessionId++;
      const subscriberId = `codex-exec-${sessionId}`;
      let subscribed = false;
      pi.events.emit(LOGS_SUBSCRIBE_CHANNEL, {
        subscriberId,
        processId: adopt.info.id,
        tailLines: 0,
        reply: (result: { ok: boolean; error?: string }) => {
          subscribed = result.ok;
        },
      });
      if (!subscribed) {
        await killProcess(pi, adopt.info.id, "SIGTERM", 3000);
        throw new Error("Could not subscribe to process logs after handover");
      }

      sessions.set(sessionId, {
        session,
        processId: adopt.info.id,
        subscriberId,
      });
      session.exitOnce().then(() => disposeSession(pi, sessionId));

      const output = session.takeOutput(maxTokens);
      return {
        content: [
          {
            type: "text",
            text: formatExecOutput({
              chunkId,
              wallTimeMs: Date.now() - startedAt,
              running: true,
              sessionId,
              exitCode: null,
              exitSignal: null,
              output: output.text,
              originalTokens: output.originalTokens,
            }),
          },
        ],
        details: { chunkId, sessionId, processId: adopt.info.id },
      };
    },
  });

  pi.registerTool({
    name: "write_stdin",
    label: "write_stdin",
    description:
      "Send input to a running exec_command session. Empty chars polls for new output; \\x03 sends Ctrl-C. Returns only the output produced since the previous call.",
    parameters: writeStdinParameters,
    async execute(_toolCallId, params) {
      const managed = sessions.get(params.session_id);
      if (!managed) {
        throw new Error(
          `Unknown session id ${params.session_id}. It may have been cleaned up after exiting; re-run the command with exec_command.`,
        );
      }
      const { session } = managed;
      const maxTokens = Math.max(
        1,
        Math.round(params.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS),
      );
      const startedAt = Date.now();
      const chunkId = nextChunkId++;

      if (params.chars === "\x03") {
        // Ctrl-C: SIGINT to the process group; the manager escalates to
        // SIGKILL after the grace period.
        await killProcess(
          pi,
          managed.processId,
          "SIGINT",
          INTERRUPT_TIMEOUT_MS,
        );
        await Promise.race([
          session.exitOnce(),
          sleep(clampPollWaitMs(params.yield_time_ms)),
        ]);
      } else if (params.chars.length > 0) {
        if (session.exited) {
          throw new Error("Session has already exited; no input was sent.");
        }
        if (!session.child.stdin?.writable) {
          throw new Error("Session stdin is closed.");
        }
        session.child.stdin.write(params.chars);
        await session.waitForOutput(clampWriteWaitMs(params.yield_time_ms));
      } else {
        // Poll: wait for new output or process exit.
        await session.waitForOutput(clampPollWaitMs(params.yield_time_ms));
      }

      const output = session.takeOutput(maxTokens);
      const running = !session.exited;
      if (!running) disposeSession(pi, params.session_id);

      return {
        content: [
          {
            type: "text",
            text: formatExecOutput({
              chunkId,
              wallTimeMs: Date.now() - startedAt,
              running,
              exitCode: session.exitCode,
              exitSignal: session.exitSignal,
              output: output.text || (running ? "(no new output)" : ""),
              originalTokens: output.originalTokens,
            }),
          },
        ],
        details: {
          chunkId,
          sessionId: params.session_id,
          running,
          exitCode: session.exitCode,
        },
      };
    },
  });
}
