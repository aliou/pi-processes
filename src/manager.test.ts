import { existsSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ManagerEvent, ProcessManager } from "./manager";

function resolveTestShell(): string {
  const candidates = [
    "/run/current-system/sw/bin/bash",
    "/bin/bash",
    "/usr/bin/bash",
    "/usr/local/bin/bash",
  ];

  const shell = candidates.find((candidate) => existsSync(candidate));
  if (!shell) {
    throw new Error("Unable to resolve bash for manager tests");
  }

  return shell;
}

function waitForEvent<T extends ManagerEvent>(
  manager: ProcessManager,
  predicate: (event: ManagerEvent) => event is T,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(`Timed out waiting for manager event after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    const unsubscribe = manager.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

function waitForMatchingEvent(
  manager: ProcessManager,
  predicate: (event: unknown) => boolean,
  timeoutMs = 3000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(
        new Error(`Timed out waiting for manager event after ${timeoutMs}ms`),
      );
    }, timeoutMs);

    const unsubscribe = manager.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

describe("ProcessManager log watches", () => {
  it("emits process_output_changed when process output arrives", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      const outputPromise = waitForMatchingEvent(
        manager,
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "process_output_changed",
      );

      manager.start("output-change-test", "printf 'hello\n'", process.cwd());

      const event = (await outputPromise) as {
        type: string;
        info: { name: string };
      };

      expect(event.type).toBe("process_output_changed");
      expect(event.info.name).toBe("output-change-test");
    } finally {
      manager.cleanup();
    }
  });

  it("merges chunked output into complete buffered lines", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      const proc = manager.start(
        "chunk-merge-test",
        "node -e \"process.stdout.write('at com.i'); setTimeout(() => process.stdout.write('ntellij\\nConnection reset\\n'), 20); setTimeout(() => process.exit(0), 40)\"",
        process.cwd(),
      );

      await waitForEvent(
        manager,
        (event): event is Extract<ManagerEvent, { type: "process_ended" }> =>
          event.type === "process_ended",
      );

      expect(manager.getCombinedOutput(proc.id, 10)).toEqual([
        { type: "stdout", text: "at com.intellij" },
        { type: "stdout", text: "Connection reset" },
      ]);
    } finally {
      manager.cleanup();
    }
  });

  it("collapses carriage-return progress updates into the latest visible line", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      const proc = manager.start(
        "carriage-return-test",
        "node -e \"process.stdout.write('\\rA'); setTimeout(() => process.stdout.write('\\rB'), 10); setTimeout(() => process.stdout.write('\\rC\\nConnection reset\\n'), 20); setTimeout(() => process.exit(0), 40)\"",
        process.cwd(),
      );

      await waitForEvent(
        manager,
        (event): event is Extract<ManagerEvent, { type: "process_ended" }> =>
          event.type === "process_ended",
      );

      expect(manager.getCombinedOutput(proc.id, 10)).toEqual([
        { type: "stdout", text: "C" },
        { type: "stdout", text: "Connection reset" },
      ]);
    } finally {
      manager.cleanup();
    }
  });

  it("keeps final partial lines when a process exits without a trailing newline", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      const proc = manager.start(
        "partial-final-line-test",
        "node -e \"process.stdout.write('Connection reset')\"",
        process.cwd(),
      );

      await waitForEvent(
        manager,
        (event): event is Extract<ManagerEvent, { type: "process_ended" }> =>
          event.type === "process_ended",
      );

      expect(manager.getOutput(proc.id, 10)).toEqual({
        stdout: ["Connection reset"],
        stderr: [],
        status: "exited",
      });
    } finally {
      manager.cleanup();
    }
  });

  it("serves recent output from memory when log files are missing", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      const proc = manager.start(
        "memory-buffer-test",
        "printf 'one\\ntwo\\n'",
        process.cwd(),
      );

      await waitForEvent(
        manager,
        (event): event is Extract<ManagerEvent, { type: "process_ended" }> =>
          event.type === "process_ended",
      );

      const logFiles = manager.getLogFiles(proc.id);
      expect(logFiles).not.toBeNull();
      rmSync(logFiles?.stdoutFile ?? "", { force: true });
      rmSync(logFiles?.stderrFile ?? "", { force: true });
      rmSync(logFiles?.combinedFile ?? "", { force: true });

      expect(manager.getOutput(proc.id, 2)).toEqual({
        stdout: ["one", "two"],
        stderr: [],
        status: "exited",
      });
      expect(manager.getCombinedOutput(proc.id, 2)).toEqual([
        { type: "stdout", text: "one" },
        { type: "stdout", text: "two" },
      ]);
    } finally {
      manager.cleanup();
    }
  });

  it("emits process_log_matched when a stdout line matches a configured log watch", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });

    try {
      const matchPromise = waitForEvent(
        manager,
        (
          event,
        ): event is Extract<ManagerEvent, { type: "process_log_matched" }> =>
          event.type === "process_log_matched",
      );

      manager.start("watch-test", "printf 'server ready\\n'", process.cwd(), {
        logWatches: [{ pattern: "server ready", stream: "stdout" }],
      });

      const event = await matchPromise;

      expect(event.info.name).toBe("watch-test");
      expect(event.match.stream).toBe("stdout");
      expect(event.match.line).toBe("server ready");
      expect(event.match.pattern).toBe("server ready");
      expect(event.match.matchCount).toBe(1);
    } finally {
      manager.cleanup();
    }
  });

  it("matches each watch only once by default", async () => {
    const manager = new ProcessManager({
      getConfiguredShellPath: () => resolveTestShell(),
    });
    const matches: Array<
      Extract<ManagerEvent, { type: "process_log_matched" }>
    > = [];

    try {
      const endPromise = waitForEvent(
        manager,
        (event): event is Extract<ManagerEvent, { type: "process_ended" }> =>
          event.type === "process_ended",
      );

      const unsubscribe = manager.onEvent((event) => {
        if (event.type === "process_log_matched") {
          matches.push(event);
        }
      });

      manager.start(
        "watch-once-test",
        "printf 'ready\\nready\\n'",
        process.cwd(),
        {
          logWatches: [{ pattern: "ready", stream: "stdout" }],
        },
      );

      await endPromise;
      unsubscribe();

      expect(matches).toHaveLength(1);
      expect(matches[0]?.match.matchCount).toBe(1);
    } finally {
      manager.cleanup();
    }
  });
});
