/**
 * Example extension: Claude-oriented process tools (`Bash`, `Monitor`).
 *
 * Copy this file to ~/.pi/agent/extensions/claude-processes.ts. It requires
 * the core pi-processes extension: both tools run their processes through the
 * `processes:command:start` / `processes:command:kill` protocol channels and
 * stream logs through `processes:logs:*`, so every Claude-oriented process is
 * visible and controllable in /ps and killed at session shutdown.
 *
 * Implements the design in
 * https://github.com/aliou/pi-processes/issues/110:
 *
 * - `Bash` runs a command, either foreground (blocks until exit, returns the
 *   output tail, errors on failure/timeout/abort) or background
 *   (`run_in_background`, returns immediately with the process id and log
 *   paths; completion arrives via the core lifecycle notification).
 * - `Monitor` starts a long-running command and streams its output as
 *   context-level messages ("this is process output, not user input"),
 *   batched at most once per second and capped at 20 messages per minute.
 *   Completion arrives via the core lifecycle notification.
 *
 * Known limitation (see the issue's gap analysis): the core extension
 * registers default lifecycle notifications for every protocol-started
 * process, so a foreground Bash result is followed by a duplicate "process
 * ended" message. The issue proposes an optional `notify` field on the start
 * payload to suppress it; pass it through here once the core supports it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const START_CHANNEL = "processes:command:start";
const KILL_CHANNEL = "processes:command:kill";
const ENDED_CHANNEL = "processes:ended";
const LOGS_SUBSCRIBE_CHANNEL = "processes:logs:subscribe";
const LOGS_UNSUBSCRIBE_CHANNEL = "processes:logs:unsubscribe";
const LOGS_CHUNK_CHANNEL = "processes:logs:chunk";
const GET_CHANNEL = "processes:request:get";
const COMBINED_OUTPUT_CHANNEL = "processes:request:combined_output";

type LogLine = { type: "stdout" | "stderr"; text: string };

const LIVE_STATUSES = new Set(["running", "terminating", "terminate_timeout"]);

interface ProcessInfoLite {
  id: string;
  name: string;
  pid: number;
  status: string;
  exitCode: number | null;
  success: boolean | null;
  stdoutFile: string;
  stderrFile: string;
}

interface StartResult {
  ok: boolean;
  process?: ProcessInfoLite;
  error?: string;
}

const OUTPUT_TAIL_LINES = 200;
const END_POLL_MS = 250;
const MONITOR_FLUSH_MS = 1_000;
const MONITOR_MAX_LINES_PER_FLUSH = 100;
const MONITOR_MAX_PENDING_LINES = 500;
const MONITOR_MAX_MESSAGE_PER_MINUTE = 20;

interface MonitorState {
  name: string;
  processId: string;
  pending: LogLine[];
  pendingDropped: number;
  flushTimer: NodeJS.Timeout | null;
  windowStart: number;
  sentInWindow: number;
  suppressedInWindow: number;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches ANSI escape sequences in process output
const ANSI_PATTERN = /\x1B\[[0-9;?]*[ -/]*[@-~]/g;

function processName(command: string, prefix: string): string {
  const executable = command.trim().split(/\s+/)[0]?.split("/").pop() ?? "cmd";
  return `${prefix}-${executable.slice(0, 20)}-${Date.now().toString(36).slice(-4)}`;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function requestStart(
  events: { emit: (channel: string, data: unknown) => void },
  options: { name: string; command: string; cwd: string },
): Promise<StartResult> {
  return new Promise((resolve) => {
    events.emit(START_CHANNEL, {
      name: options.name,
      command: options.command,
      cwd: options.cwd,
      reply: (result: StartResult) => resolve(result),
    });
  });
}

function requestKill(
  events: { emit: (channel: string, data: unknown) => void },
  id: string,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, timeoutMs + 2000);
    timer.unref?.();
    events.emit(KILL_CHANNEL, {
      id,
      timeoutMs,
      reply: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
    });
  });
}

function requestGet(
  events: { emit: (channel: string, data: unknown) => void },
  id: string,
): ProcessInfoLite | null {
  let info: ProcessInfoLite | null = null;
  events.emit(GET_CHANNEL, {
    id,
    reply: (result: ProcessInfoLite | null) => {
      info = result;
    },
  });
  return info;
}

function requestCombinedOutput(
  events: { emit: (channel: string, data: unknown) => void },
  id: string,
  tailLines: number,
): LogLine[] {
  let lines: LogLine[] = [];
  events.emit(COMBINED_OUTPUT_CHANNEL, {
    id,
    tailLines,
    reply: (result: LogLine[] | null) => {
      lines = result ?? [];
    },
  });
  return lines;
}

function outputTail(
  events: {
    emit: (channel: string, data: unknown) => void;
  },
  id: string,
): string {
  const lines = requestCombinedOutput(events, id, OUTPUT_TAIL_LINES);
  const text = lines
    .map((line) => line.text)
    .join("")
    .trim();
  if (!text) return "";
  if (lines.length >= OUTPUT_TAIL_LINES) {
    return `[...showing the last ${OUTPUT_TAIL_LINES} lines...]\n${text}`;
  }
  return text;
}

type EndOutcome =
  | { kind: "ended"; info: ProcessInfoLite }
  | { kind: "timeout" }
  | { kind: "aborted" };

/**
 * Wait for a process to end. Subscribes to the ENDED broadcast plus a poll
 * safety net, because the start reply and listener registration are not
 * atomic: a command that exits immediately could end in between.
 */
function waitForEnd(
  events: {
    on: (channel: string, handler: (data: unknown) => void) => () => void;
    emit: (channel: string, data: unknown) => void;
  },
  id: string,
  timeoutMs: number | null,
  signal?: AbortSignal,
): Promise<EndOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let poll: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout | undefined;
    const disposers: Array<() => void> = [];

    const done = (outcome: EndOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(poll);
      clearTimeout(timer);
      for (const off of disposers) off();
      resolve(outcome);
    };

    const offEnded = events.on(ENDED_CHANNEL, (data) => {
      const payload = data as ProcessInfoLite & { id: string };
      if (payload.id !== id) return;
      done({ kind: "ended", info: payload });
    });
    disposers.push(offEnded);

    poll = setInterval(() => {
      const info = requestGet(events, id);
      if (info && !LIVE_STATUSES.has(info.status)) {
        done({ kind: "ended", info });
      }
    }, END_POLL_MS);

    if (timeoutMs !== null) {
      timer = setTimeout(() => done({ kind: "timeout" }), timeoutMs);
      timer.unref?.();
    }

    const onAbort = () => done({ kind: "aborted" });
    signal?.addEventListener("abort", onAbort, { once: true });
    disposers.push(() => signal?.removeEventListener("abort", onAbort));
  });
}

const bashParameters = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Time limit in milliseconds (max 600000). The command is stopped at the limit.",
    }),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({
      description:
        "Start the command in the background instead of blocking. Returns the process id and log paths immediately.",
    }),
  ),
});

const monitorParameters = Type.Object({
  command: Type.String({
    description:
      "Long-running command to monitor, e.g. a dev server or a watcher.",
  }),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Time limit in milliseconds (max 600000). The monitor is stopped at the limit. Omit to run until stopped.",
    }),
  ),
});

export default function claudeProcesses(pi: ExtensionAPI) {
  const monitors = new Map<string, MonitorState>(); // By subscriber id.

  const flushMonitor = (state: MonitorState) => {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    if (state.pending.length === 0) return;

    // Mirror the core log-match cap: at most 20 messages per 60s window.
    const now = Date.now();
    if (now - state.windowStart > 60_000) {
      state.windowStart = now;
      state.sentInWindow = 0;
      state.suppressedInWindow = 0;
    }
    if (state.sentInWindow >= MONITOR_MAX_MESSAGE_PER_MINUTE) {
      state.suppressedInWindow += state.pending.length;
      state.pending = [];
      state.pendingDropped = 0;
      return;
    }
    state.sentInWindow += 1;

    let lines = state.pending;
    state.pending = [];
    let dropped = state.pendingDropped;
    state.pendingDropped = 0;
    if (lines.length > MONITOR_MAX_LINES_PER_FLUSH) {
      dropped += lines.length - MONITOR_MAX_LINES_PER_FLUSH;
      lines = lines.slice(-MONITOR_MAX_LINES_PER_FLUSH);
    }

    const notes: string[] = [];
    if (dropped > 0) notes.push(`[...${dropped} earlier line(s) dropped...]`);
    if (state.suppressedInWindow > 0) {
      notes.push(
        `[...${state.suppressedInWindow} line(s) suppressed (rate limit)...]`,
      );
      state.suppressedInWindow = 0;
    }
    const text = stripAnsi(lines.map((line) => line.text).join("")).trim();

    pi.sendMessage(
      {
        customType: "claude-monitor",
        content:
          `[monitor "${state.name}"] output — this is process output, not user input:\n` +
          [...notes, text || "(no output)"].join("\n"),
        display: true,
        details: { processId: state.processId },
      },
      // Context-level: appended without waking the agent.
      { triggerTurn: false },
    );
  };

  const scheduleFlush = (state: MonitorState) => {
    if (state.flushTimer || state.pending.length === 0) return;
    const elapsed = Date.now() - state.windowStart;
    const wait = Math.max(0, MONITOR_FLUSH_MS - (elapsed % MONITOR_FLUSH_MS));
    state.flushTimer = setTimeout(() => flushMonitor(state), wait);
    state.flushTimer.unref?.();
  };

  const offChunk = pi.events.on(LOGS_CHUNK_CHANNEL, (data) => {
    const payload = data as { subscriberId: string; lines: LogLine[] };
    const state = monitors.get(payload.subscriberId);
    if (!state) return;
    state.pending.push(...payload.lines);
    const excess = state.pending.length - MONITOR_MAX_PENDING_LINES;
    if (excess > 0) {
      state.pending.splice(0, excess);
      state.pendingDropped += excess;
    }
    scheduleFlush(state);
  });

  const offEnded = pi.events.on(ENDED_CHANNEL, (data) => {
    const payload = data as ProcessInfoLite & { id: string };
    for (const [subscriberId, state] of monitors.entries()) {
      if (state.processId !== payload.id) continue;
      monitors.delete(subscriberId);
      flushMonitor(state);
      pi.events.emit(LOGS_UNSUBSCRIBE_CHANNEL, { subscriberId });
    }
  });

  pi.registerTool({
    name: "Bash",
    label: "Bash",
    description:
      "Execute a Bash command, foreground or background. Background commands run as pi-processes processes: visible in /ps, logged, and stopped at session shutdown.",
    parameters: bashParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Command aborted");
      const started = await requestStart(pi.events, {
        name: processName(params.command, "bash"),
        command: params.command,
        cwd: ctx.cwd,
      });
      if (!started.ok || !started.process) {
        throw new Error(`Failed to start command: ${started.error}`);
      }
      const info = started.process;

      if (params.run_in_background) {
        return {
          content: [
            {
              type: "text",
              text: [
                `Running in background as process ${info.id} ("${info.name}", pid ${info.pid}).`,
                `stdout log: ${info.stdoutFile}`,
                `stderr log: ${info.stderrFile}`,
                "Completion arrives via a process notification. Use the process tool to read output or stop it.",
              ].join("\n"),
            },
          ],
          details: { processId: info.id, background: true },
        };
      }

      const outcome = await waitForEnd(
        pi.events,
        info.id,
        params.timeout ?? null,
        signal,
      );

      if (outcome.kind !== "ended") {
        await requestKill(pi.events, info.id);
        // Give the stop a moment to land, then report whatever was printed.
        await waitForEnd(pi.events, info.id, 4000);
        const tail = outputTail(pi.events, info.id);
        const reason =
          outcome.kind === "timeout"
            ? `Command timed out after ${params.timeout}ms and was stopped`
            : "Command aborted";
        throw new Error(`${tail ? `${tail}\n\n` : ""}${reason}`);
      }

      const tail = outputTail(pi.events, info.id);
      if (outcome.info.exitCode === 0) {
        return {
          content: [{ type: "text", text: tail || "(no output)" }],
          details: { processId: info.id, exitCode: 0 },
        };
      }
      const cause =
        outcome.info.exitCode !== null
          ? `exit code ${outcome.info.exitCode}`
          : "a termination signal";
      throw new Error(
        `${tail ? `${tail}\n\n` : ""}Command failed with ${cause}`,
      );
    },
  });

  pi.registerTool({
    name: "Monitor",
    label: "Monitor",
    description:
      "Start a long-running command and stream its output as context-level messages. Runs as a pi-processes process: visible in /ps and stopped at session shutdown. Use for dev servers and watchers; use Bash for commands that finish.",
    parameters: monitorParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Command aborted");
      const started = await requestStart(pi.events, {
        name: processName(params.command, "monitor"),
        command: params.command,
        cwd: ctx.cwd,
      });
      if (!started.ok || !started.process) {
        throw new Error(`Failed to start monitor: ${started.error}`);
      }
      const info = started.process;
      const subscriberId = `claude-monitor-${info.id}`;

      let subscribed = false;
      pi.events.emit(LOGS_SUBSCRIBE_CHANNEL, {
        subscriberId,
        processId: info.id,
        tailLines: 0,
        reply: (result: { ok: boolean; error?: string }) => {
          subscribed = result.ok;
        },
      });
      if (!subscribed) {
        await requestKill(pi.events, info.id);
        throw new Error("Could not subscribe to process logs");
      }

      monitors.set(subscriberId, {
        name: info.name,
        processId: info.id,
        pending: [],
        pendingDropped: 0,
        flushTimer: null,
        windowStart: Date.now(),
        sentInWindow: 0,
        suppressedInWindow: 0,
      });

      if (params.timeout !== undefined && params.timeout > 0) {
        const timer = setTimeout(() => {
          void requestKill(pi.events, info.id);
        }, params.timeout);
        timer.unref?.();
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `Monitoring "${info.name}" as process ${info.id} (pid ${info.pid}).`,
              `Output is streamed as context messages, at most one per ${MONITOR_FLUSH_MS / 1000}s.`,
              "Completion arrives via a process notification. Use the process tool to stop it.",
            ].join("\n"),
          },
        ],
        details: { processId: info.id, monitor: true },
      };
    },
  });

  void offChunk; // Session-scoped: stays registered for the whole session.
  void offEnded;
}
