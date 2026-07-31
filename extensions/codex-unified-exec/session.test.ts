import { describe, expect, it } from "vitest";

import type { ManagerEvent, ProcessInfo, WriteResult } from "../../src/manager";
import { SessionManager } from "./session";
import { approxTokensFromByteCount } from "./truncation";

/**
 * Minimal ProcessManager stand-in: records starts, lets the test push raw
 * output chunks and end processes via the same onRawOutput/onEvent surface the
 * real manager exposes. PIDs are huge unused numbers; killProcessGroup on them
 * throws ESRCH (caught) so no real process is ever signalled.
 */
class FakeManager {
  private rawListener?: (id: string, chunk: Buffer) => void;
  private eventListener?: (event: ManagerEvent) => void;
  private nextId = 1;
  private procs = new Map<
    string,
    { info: ProcessInfo; ended: boolean; stdin: string[] }
  >();

  startedIds: string[] = [];
  lastInfo!: ProcessInfo;
  clearFinishedCalls = 0;

  private makeInfo(overrides: Partial<ProcessInfo>): ProcessInfo {
    const id = `p${this.nextId}`;
    this.nextId += 1;
    return {
      id,
      name: "",
      pid: 99_990_000 + this.nextId,
      command: "",
      cwd: "",
      startTime: Date.now(),
      endTime: null,
      status: "running",
      exitCode: null,
      success: null,
      stdoutFile: "",
      stderrFile: "",
      endReason: null,
      signal: null,
      errorMessage: null,
      ...overrides,
    };
  }

  start(name: string, command: string, cwd: string): ProcessInfo {
    const info = this.makeInfo({ name, command, cwd });
    this.procs.set(info.id, { info, ended: false, stdin: [] });
    this.startedIds.push(info.id);
    this.lastInfo = info;
    return info;
  }

  get(id: string): ProcessInfo | null {
    return this.procs.get(id)?.info ?? null;
  }

  onRawOutput(listener: (id: string, chunk: Buffer) => void): () => void {
    this.rawListener = listener;
    return () => {
      this.rawListener = undefined;
    };
  }

  onEvent(listener: (event: ManagerEvent) => void): () => void {
    this.eventListener = listener;
    return () => {
      this.eventListener = undefined;
    };
  }

  writeToStdin(id: string, data: string): WriteResult {
    const proc = this.procs.get(id);
    if (!proc) return { ok: false, reason: "not_found" };
    if (proc.ended) return { ok: false, reason: "process_exited" };
    proc.stdin.push(data);
    return { ok: true };
  }

  killAll(): void {}
  clearFinished(): number {
    this.clearFinishedCalls += 1;
    return 0;
  }
  cleanup(): void {}

  stdinOf(id: string): string[] {
    return this.procs.get(id)?.stdin ?? [];
  }

  /** Test driver: push a raw output chunk for a process. */
  emitRaw(id: string, chunk: Buffer): void {
    this.rawListener?.(id, chunk);
  }

  /** Test driver: end a process, emitting process_ended like the real manager. */
  end(id: string, exitCode: number): void {
    const proc = this.procs.get(id);
    if (!proc || proc.ended) return;
    proc.ended = true;
    proc.info.status = "exited";
    proc.info.exitCode = exitCode;
    proc.info.endTime = Date.now();
    proc.info.success = exitCode === 0;
    this.eventListener?.({
      type: "process_ended",
      info: { ...proc.info },
    });
  }
}

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

describe("SessionManager", () => {
  let manager: FakeManager;
  let sessions: SessionManager;

  function make(opts?: ConstructorParameters<typeof SessionManager>[1]): void {
    manager = new FakeManager();
    sessions = new SessionManager(manager, opts);
  }

  it("dispose() does not throw", () => {
    make();
    expect(() => sessions.dispose()).not.toThrow();
  });

  it("rejects tty:true (pipe-only build)", async () => {
    make();
    await expect(
      sessions.execCommand({
        cmd: "echo hi",
        cwd: "/tmp",
        yield_time_ms: 500,
        tty: true,
      }),
    ).rejects.toThrow(/tty/);
  });

  it("exec_command collects output of a short-lived command and releases it", async () => {
    make();
    const p = sessions.execCommand({
      cmd: "echo hi",
      cwd: "/tmp",
      yield_time_ms: 500,
    });
    await tick();
    manager.emitRaw(manager.lastInfo.id, Buffer.from("hi\n", "utf8"));
    manager.end(manager.lastInfo.id, 0);

    const out = await p;
    expect(out.exitCode).toBe(0);
    expect(out.processId).toBe(null); // exited -> released, no session id
    expect(out.rawOutput.toString("utf8")).toBe("hi\n");
    expect(out.originalTokenCount).toBe(approxTokensFromByteCount(3));
    expect(out.chunkId).toMatch(/^[0-9a-f]{6}$/);
  });

  it("reaps finished records from the underlying manager when a session ends", async () => {
    make();
    const p = sessions.execCommand({
      cmd: "echo hi",
      cwd: "/tmp",
      yield_time_ms: 500,
    });
    await tick();
    manager.emitRaw(manager.lastInfo.id, Buffer.from("hi\n", "utf8"));
    manager.end(manager.lastInfo.id, 0);

    const out = await p;
    expect(out.exitCode).toBe(0);
    // Releasing the exited session reaps terminal records so hidden codex
    // commands do not accumulate records/log files in the isolated manager.
    expect(manager.clearFinishedCalls).toBeGreaterThan(0);
  });

  it("keeps a still-running command alive and returns its session id", async () => {
    make();
    const p = sessions.execCommand({
      cmd: "long-running",
      cwd: "/tmp",
      yield_time_ms: 40,
    });
    const out = await p; // times out without ending
    expect(out.exitCode).toBe(null);
    expect(out.processId).not.toBe(null);
  });

  it("write_stdin rejects an unknown session id (matches codex UnknownProcessId)", async () => {
    make();
    await expect(
      sessions.writeStdin({
        session_id: 424_242,
        chars: "x",
        yield_time_ms: 250,
      }),
    ).rejects.toThrow(/unknown session id 424242/);
  });

  it("write_stdin writes chars to stdin and, after the process ends, reports the exit code", async () => {
    make();
    const aliveP = sessions.execCommand({
      cmd: "cat",
      cwd: "/tmp",
      yield_time_ms: 40,
    });
    const alive = await aliveP;
    const codexId = alive.processId as number;
    const piId = manager.lastInfo.id;

    const writeP = sessions.writeStdin({
      session_id: codexId,
      chars: "hello\n",
      yield_time_ms: 250,
    });
    await tick(5);
    expect(manager.stdinOf(piId)).toContain("hello\n");

    // End the process so the post-write collect short-circuits instead of waiting.
    manager.end(piId, 0);
    const out = await writeP;
    expect(out.exitCode).toBe(0);
    expect(out.processId).toBe(null); // exited -> released
  });

  it("evicts the least-recently-used session once at capacity (codex prune)", async () => {
    make({ maxProcesses: 9 });
    const ids: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const out = await sessions.execCommand({
        cmd: `c${i}`,
        cwd: "/tmp",
        yield_time_ms: 40,
      });
      ids.push(out.processId as number);
    }
    // All alive (timed out without ending): 9 sessions held.
    expect(ids.every((id) => id !== null)).toBe(true);

    // 10th spawn triggers pruning of the oldest non-protected session (ids[0]).
    await sessions.execCommand({
      cmd: "c9",
      cwd: "/tmp",
      yield_time_ms: 40,
    });

    await expect(
      sessions.writeStdin({
        session_id: ids[0],
        chars: "x",
        yield_time_ms: 250,
      }),
    ).rejects.toThrow(/unknown session/);

    // A protected (recent) session survives.
    const keepP = sessions.writeStdin({
      session_id: ids[8],
      chars: "x",
      yield_time_ms: 250,
    });
    await tick(5);
    manager.end(manager.startedIds[8], 0);
    const kept = await keepP;
    expect(kept.exitCode).toBe(0);
  });
});
