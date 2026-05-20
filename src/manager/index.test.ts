import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { vol } from "memfs";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ManagerEvent } from "../types";
import { LIVE_STATUSES } from "../types";
import { ProcessManager } from ".";

vi.mock("node:fs");
vi.mock("node:fs/promises");

const fakeProcesses = new Map<number, FakeChildProcess>();
let nextPid = 10_000;

class FakeChildProcess extends EventEmitter {
  pid = ++nextPid;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  unref(): void {}

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    this.finish(null, signal);
    return true;
  }

  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    fakeProcesses.delete(this.pid);
    this.stdout.end();
    this.stderr.end();
    queueMicrotask(() => this.emit("close", code, signal));
  }
}

function emitCommandOutput(child: FakeChildProcess, command: string): void {
  if (child.killed || child.stdout.writableEnded || child.stderr.writableEnded)
    return;

  if (command === "true") {
    child.finish(0);
    return;
  }

  if (command === "exit 1") {
    child.finish(1);
    return;
  }

  if (command.includes("sleep 60")) {
    return;
  }

  if (command.startsWith("seq 1 ")) {
    const count = Number(command.slice("seq 1 ".length));
    for (let i = 1; i <= count; i++) child.stdout.write(`${i}\n`);
    child.finish(0);
    return;
  }

  if (command === "printf ready") {
    child.stdout.write("ready");
    child.finish(0);
    return;
  }

  if (command.includes("echo err >&2") && command.includes("echo out")) {
    child.stdout.write("out\n");
    child.stderr.write("err\n");
    child.finish(0);
    return;
  }

  if (command.includes("echo marker; echo marker >&2")) {
    child.stdout.write("marker\n");
    child.stderr.write("marker\n");
    child.finish(0);
    return;
  }

  if (command.includes("echo ready")) {
    child.stdout.write("ready\nready\nready\n");
    child.finish(0);
    return;
  }

  if (command.includes("echo done")) {
    child.stdout.write("done\ndone\ndone\n");
    child.finish(0);
    return;
  }

  if (command === "echo err >&2") {
    child.stderr.write("err\n");
    child.finish(0);
    return;
  }

  const echo = command.match(/^echo (.*)$/);
  if (echo) {
    child.stdout.write(`${echo[1]}\n`);
    child.finish(0);
    return;
  }

  child.finish(0);
}

vi.mock("../utils/command-executor", () => ({
  resolveShellExecutable: vi.fn(() => "/bin/bash"),
  spawnCommand: vi.fn((command: string) => {
    const child = new FakeChildProcess();
    fakeProcesses.set(child.pid, child);
    queueMicrotask(() => emitCommandOutput(child, command));
    return child;
  }),
}));

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return {
    ...actual,
    isProcessGroupAlive: vi.fn((pid: number) => fakeProcesses.has(pid)),
    killProcessGroup: vi.fn((pid: number, signal: NodeJS.Signals) => {
      const child = fakeProcesses.get(pid);
      if (child) child.kill(signal);
    }),
  };
});

beforeEach(() => {
  vi.useRealTimers();
  vol.reset();
  fakeProcesses.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function waitForEnd(manager: ProcessManager, id: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = manager.onEvent((e) => {
      if (e.type === "process_ended" && e.info.id === id) {
        unsub();
        resolve();
      }
    });
  });
}

function waitForEndedCount(
  manager: ProcessManager,
  count: number,
): Promise<void> {
  let seen = 0;
  return new Promise((resolve) => {
    const unsub = manager.onEvent((e) => {
      if (e.type !== "process_ended") return;
      seen++;
      if (seen < count) return;

      unsub();
      resolve();
    });
  });
}

function collectEvents(manager: ProcessManager): ManagerEvent[] {
  const events: ManagerEvent[] = [];
  manager.onEvent((e) => events.push(e));
  return events;
}

// --- Start / List / Get basics ---

describe("start/list/get basics", () => {
  it("starts a process and returns ProcessInfo", () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hello", "/tmp");

    expect(info.id).toMatch(/^proc_\d+$/);
    expect(info).toEqual(
      expect.objectContaining({
        name: "test",
        command: "echo hello",
        cwd: "/tmp",
        status: "running",
        success: null,
        exitCode: null,
        endTime: null,
        alertOnSuccess: false,
        alertOnFailure: true,
        alertOnKill: false,
      }),
    );
    expect(info.pid).toBeGreaterThan(0);
  });

  it("lists processes in reverse insertion order", () => {
    using manager = new ProcessManager();
    const info1 = manager.start("first", "echo one", "/tmp");
    const info2 = manager.start("second", "echo two", "/tmp");

    const list = manager.list();
    expect(list.map((p) => p.id)).toEqual([info2.id, info1.id]);
  });

  it("gets a process by id", () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hello", "/tmp");

    const got = manager.get(info.id);
    assert(got, "process should exist");
    expect(got).toEqual(expect.objectContaining({ id: info.id, name: "test" }));
  });

  it("returns null for unknown process id", () => {
    using manager = new ProcessManager();
    expect(manager.get("nonexistent")).toBeNull();
  });

  it("custom alert flags in StartOptions", () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hi", "/tmp", {
      alertOnSuccess: true,
      alertOnFailure: false,
      alertOnKill: true,
    });

    expect(info).toEqual(
      expect.objectContaining({
        alertOnSuccess: true,
        alertOnFailure: false,
        alertOnKill: true,
      }),
    );
  });
});

// --- Process lifecycle events ---

describe("lifecycle events", () => {
  it("emits process_started on start", () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    manager.start("test", "echo hi", "/tmp");

    const started = events.filter((e) => e.type === "process_started");
    expect(started).toHaveLength(1);
    if (started[0].type === "process_started") {
      expect(started[0].info).toEqual(
        expect.objectContaining({ name: "test" }),
      );
    }
  });

  it("emits process_ended on exit", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo hi", "/tmp");
    await waitForEnd(manager, info.id);

    const ended = events.filter((e) => e.type === "process_ended");
    expect(ended).toHaveLength(1);
    if (ended[0].type === "process_ended") {
      expect(ended[0].info).toEqual(
        expect.objectContaining({
          id: info.id,
          status: "exited",
          success: true,
          exitCode: 0,
        }),
      );
      expect(ended[0].info.endTime).not.toBeNull();
    }
  });

  it("emits process_ended with success=false on failure", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "exit 1", "/tmp");
    await waitForEnd(manager, info.id);

    const ended = events.filter((e) => e.type === "process_ended");
    if (ended[0].type === "process_ended") {
      expect(ended[0].info).toEqual(
        expect.objectContaining({ success: false, exitCode: 1 }),
      );
    }
  });

  it("emits processes_changed on clearFinished", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo hi", "/tmp");
    await waitForEnd(manager, info.id);

    manager.clearFinished();

    const changed = events.filter((e) => e.type === "processes_changed");
    expect(changed).toHaveLength(1);
  });
});

// --- Output throttling ---

describe("process_output_changed", () => {
  it("emits process_output_changed on stdout", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo hello", "/tmp");
    await waitForEnd(manager, info.id);

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("emits process_output_changed on stderr", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo err >&2", "/tmp");
    await waitForEnd(manager, info.id);

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("throttles rapid output", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "seq 1 200", "/tmp");
    await waitForEnd(manager, info.id);

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(outputEvents.length).toBeGreaterThanOrEqual(1);
    expect(outputEvents.length).toBeLessThan(50);
  });

  it("final output event before process_ended", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo hello", "/tmp");
    await waitForEnd(manager, info.id);

    let lastOutputIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "process_output_changed") {
        lastOutputIdx = i;
        break;
      }
    }
    const endIdx = events.findIndex((e) => e.type === "process_ended");

    expect(lastOutputIdx).toBeGreaterThanOrEqual(0);
    expect(endIdx).toBeGreaterThanOrEqual(0);
    expect(lastOutputIdx).toBeLessThan(endIdx);
  });

  it("no output events for silent process", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "true", "/tmp");
    await waitForEnd(manager, info.id);

    const outputEvents = events.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(outputEvents.length).toBe(0);
  });

  it("no stale events after clearFinished", async () => {
    vi.useFakeTimers();
    using manager = new ProcessManager();
    const info = manager.start("test", "seq 1 50", "/tmp");
    await waitForEnd(manager, info.id);

    manager.clearFinished();

    const lateEvents: ManagerEvent[] = [];
    manager.onEvent((e) => lateEvents.push(e));

    await vi.runOnlyPendingTimersAsync();

    const staleOutput = lateEvents.filter(
      (e) => e.type === "process_output_changed",
    );
    expect(staleOutput.length).toBe(0);
  });

  it("output events include appendedText with new lines", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo hello", "/tmp");
    await waitForEnd(manager, info.id);

    const withAppended = events.filter(
      (e): e is Extract<typeof e, { type: "process_output_changed" }> =>
        e.type === "process_output_changed" && e.appendedText !== undefined,
    );

    for (const e of withAppended) {
      assert(e.appendedText, "appendedText should be defined");
      expect(Array.isArray(e.appendedText)).toBe(true);
      for (const line of e.appendedText) {
        expect(["stdout", "stderr"]).toContain(line.type);
        expect(typeof line.text).toBe("string");
      }
    }
  });

  it("output events include final partial lines in appendedText", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "printf ready", "/tmp");
    await waitForEnd(manager, info.id);

    const outputEvents = events.filter(
      (e): e is Extract<ManagerEvent, { type: "process_output_changed" }> =>
        e.type === "process_output_changed",
    );

    expect(outputEvents).toContainEqual(
      expect.objectContaining({
        appendedText: [{ type: "stdout", text: "ready" }],
      }),
    );
  });
});

// --- killAll ---

describe("killAll", () => {
  it("kills all running processes", async () => {
    using manager = new ProcessManager();
    manager.start("p1", "sleep 60", "/tmp");
    manager.start("p2", "sleep 60", "/tmp");

    const ended = waitForEndedCount(manager, 2);
    manager.killAll();
    await ended;

    for (const p of manager.list()) {
      expect(LIVE_STATUSES.has(p.status)).toBe(false);
    }
  });
});

// --- Watch matching ---

describe("process_watch_matched", () => {
  it("fires once by default on first matching line", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start(
      "watch-once",
      "bash -c 'echo ready; echo ready; echo ready'",
      "/tmp",
      {
        logWatches: [{ pattern: "ready" }],
      },
    );

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);

    const first = matches[0];
    if (first.type === "process_watch_matched") {
      expect(first.match).toEqual(
        expect.objectContaining({
          processId: info.id,
          source: "stdout",
          line: "ready",
        }),
      );
      expect(first.match.watch.repeat).toBe(false);
    }
  });

  it("supports repeat watches", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start(
      "watch-repeat",
      "bash -c 'echo done; echo done; echo done'",
      "/tmp",
      {
        logWatches: [{ pattern: "done", repeat: true }],
      },
    );

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(3);
  });

  it("respects stream scoping", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start(
      "watch-stream",
      "bash -c 'echo out; echo err >&2'",
      "/tmp",
      {
        logWatches: [{ pattern: "err", stream: "stderr" }],
      },
    );

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);

    const match = matches[0];
    if (match.type === "process_watch_matched") {
      expect(match.match).toEqual(
        expect.objectContaining({ source: "stderr", line: "err" }),
      );
    }
  });

  it("stream both matches stdout and stderr", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start(
      "watch-both",
      "bash -c 'echo marker; echo marker >&2'",
      "/tmp",
      {
        logWatches: [{ pattern: "marker", stream: "both", repeat: true }],
      },
    );

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(2);

    const sources = new Set(
      matches
        .filter(
          (e): e is Extract<ManagerEvent, { type: "process_watch_matched" }> =>
            e.type === "process_watch_matched",
        )
        .map((e) => e.match.source),
    );

    expect(sources).toEqual(new Set(["stdout", "stderr"]));
  });

  it("matches trailing partial line at process end", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start("watch-trailing", "printf ready", "/tmp", {
      logWatches: [{ pattern: "ready" }],
    });

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);
  });

  it("throws for invalid watch regex", () => {
    using manager = new ProcessManager();

    expect(() =>
      manager.start("bad-watch", "echo ok", "/tmp", {
        logWatches: [{ pattern: "(", mode: "regex" }],
      }),
    ).toThrowError(/Invalid log watch pattern/);
  });

  it("uses literal watch matching by default", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);

    const info = manager.start("literal-watch", "echo '('", "/tmp", {
      logWatches: [{ pattern: "(" }],
    });

    await waitForEnd(manager, info.id);

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);
  });

  it("adds log watches to a running process", () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("late-watch", "sleep 60", "/tmp");

    expect(manager.addLogWatches(info.id, [{ pattern: "late ready" }])).toEqual(
      {
        ok: true,
        added: 1,
      },
    );

    const child = fakeProcesses.get(info.pid);
    assert(child, "fake child should exist");
    child.stdout.write("late ready\n");

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);
    if (matches[0].type === "process_watch_matched") {
      expect(matches[0].match.watch.index).toBe(0);
    }
  });

  it("appends log watches after existing watches", () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("late-watch", "sleep 60", "/tmp", {
      logWatches: [{ pattern: "first" }],
    });

    expect(manager.addLogWatches(info.id, [{ pattern: "second" }])).toEqual({
      ok: true,
      added: 1,
    });

    const child = fakeProcesses.get(info.pid);
    assert(child, "fake child should exist");
    child.stdout.write("second\n");

    const matches = events.filter((e) => e.type === "process_watch_matched");
    expect(matches).toHaveLength(1);
    if (matches[0].type === "process_watch_matched") {
      expect(matches[0].match.watch.index).toBe(1);
    }
  });

  it("returns not_found when adding watches to an unknown process", () => {
    using manager = new ProcessManager();

    expect(manager.addLogWatches("missing", [{ pattern: "late" }])).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns process_exited when adding watches to a finished process", async () => {
    using manager = new ProcessManager();
    const info = manager.start("finished", "echo hi", "/tmp");
    await waitForEnd(manager, info.id);

    expect(manager.addLogWatches(info.id, [{ pattern: "late" }])).toEqual({
      ok: false,
      reason: "process_exited",
    });
  });
});

// --- Kill ---

describe("kill", () => {
  it("returns not_found for unknown id", async () => {
    using manager = new ProcessManager();
    const result = await manager.kill("nonexistent");
    expect(result).toEqual({
      ok: false,
      reason: "not_found",
      info: expect.any(Object),
    });
  });

  it("kills a running process", async () => {
    vi.useFakeTimers();
    using manager = new ProcessManager();
    const info = manager.start("test", "sleep 60", "/tmp");
    const resultPromise = manager.kill(info.id);

    await vi.advanceTimersByTimeAsync(3000);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(["killed", "exited"]).toContain(result.info.status);
    }
  });

  it("returns ok for already-exited process", async () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hi", "/tmp");
    await waitForEnd(manager, info.id);

    const result = await manager.kill(info.id);
    expect(result).toEqual({ ok: true, info: expect.any(Object) });
  });

  it("sets alertOnKill to false on kill", async () => {
    vi.useFakeTimers();
    using manager = new ProcessManager();
    const info = manager.start("test", "sleep 60", "/tmp", {
      alertOnKill: true,
    });

    const resultPromise = manager.kill(info.id);
    await vi.advanceTimersByTimeAsync(3000);
    await resultPromise;

    const updated = manager.get(info.id);
    assert(updated, "process should exist");
    expect(updated.alertOnKill).toBe(false);
  });
});

// --- Write to stdin ---

describe("writeToStdin", () => {
  it("returns not_found for unknown id", () => {
    using manager = new ProcessManager();
    expect(manager.writeToStdin("nonexistent", "hello")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns process_exited for finished process", async () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hi", "/tmp");
    await waitForEnd(manager, info.id);

    expect(manager.writeToStdin(info.id, "hello")).toEqual({
      ok: false,
      reason: "process_exited",
    });
  });

  it("writes to stdin of running process", () => {
    using manager = new ProcessManager();
    const info = manager.start(
      "test",
      "bash -c 'cat > /dev/null; sleep 60'",
      "/tmp",
    );

    expect(manager.writeToStdin(info.id, "hello\n")).toEqual({ ok: true });
  });

  it("returns stdin_closed after end()", () => {
    using manager = new ProcessManager();
    const info = manager.start(
      "test",
      "bash -c 'cat > /dev/null; sleep 60'",
      "/tmp",
    );

    expect(manager.writeToStdin(info.id, "hello\n", { end: true })).toEqual({
      ok: true,
    });
    expect(manager.writeToStdin(info.id, "more\n")).toEqual({
      ok: false,
      reason: "stdin_closed",
    });
  });
});

// --- clearFinished ---

describe("clearFinished", () => {
  it("clears finished processes and returns count", async () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hi", "/tmp");
    await waitForEnd(manager, info.id);

    expect(manager.clearFinished()).toBe(1);
    expect(manager.get(info.id)).toBeNull();
  });

  it("does not clear running processes", () => {
    using manager = new ProcessManager();
    manager.start("test", "sleep 60", "/tmp");

    expect(manager.clearFinished()).toBe(0);
  });

  it("emits processes_changed when clearing", async () => {
    using manager = new ProcessManager();
    const events = collectEvents(manager);
    const info = manager.start("test", "echo hi", "/tmp");
    await waitForEnd(manager, info.id);

    manager.clearFinished();

    const changed = events.filter((e) => e.type === "processes_changed");
    expect(changed).toHaveLength(1);
  });
});

// --- Output retrieval ---

describe("output retrieval", () => {
  it("getOutput returns stdout/stderr lines", async () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hello", "/tmp");
    await waitForEnd(manager, info.id);

    const output = manager.getOutput(info.id);
    assert(output, "output should exist");
    expect(output.stdout).toContain("hello");
  });

  it("getOutput returns null for unknown id", () => {
    using manager = new ProcessManager();
    expect(manager.getOutput("nonexistent")).toBeNull();
  });

  it("getCombinedOutput returns tagged lines", async () => {
    using manager = new ProcessManager();
    const info = manager.start(
      "test",
      "bash -c 'echo out; echo err >&2'",
      "/tmp",
    );
    await waitForEnd(manager, info.id);

    const combined = manager.getCombinedOutput(info.id);
    assert(combined, "combined output should exist");
    expect(combined.length).toBeGreaterThanOrEqual(2);
    expect(
      combined.filter((l) => l.type === "stdout").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      combined.filter((l) => l.type === "stderr").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("getLogFiles returns file paths", async () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hi", "/tmp");
    await waitForEnd(manager, info.id);

    const files = manager.getLogFiles(info.id);
    assert(files, "log files should exist");
    expect(files).toEqual(
      expect.objectContaining({
        stdoutFile: expect.stringContaining("stdout"),
        stderrFile: expect.stringContaining("stderr"),
        combinedFile: expect.stringContaining("combined"),
      }),
    );
  });

  it("getFileSize returns sizes", async () => {
    using manager = new ProcessManager();
    const info = manager.start("test", "echo hello world", "/tmp");
    await waitForEnd(manager, info.id);

    const sizes = manager.getFileSize(info.id);
    assert(sizes, "file sizes should exist");
    expect(sizes.stdout).toBeGreaterThan(0);
  });
});
