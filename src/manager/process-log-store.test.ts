import { tmpdir } from "node:os";
import { fs, vol } from "memfs";
import { assert, beforeEach, describe, expect, it } from "vitest";

import { MAX_TAIL_READ_BYTES } from "./limits";
import { ProcessLogStore } from "./process-log-store";

describe("ProcessLogStore", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("uses a unique default log directory", () => {
    using first = new ProcessLogStore();
    using second = new ProcessLogStore();

    expect(first.getLogDir()).not.toEqual(second.getLogDir());
  });

  it("creates log files on createLogs", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    expect(paths).toEqual({
      stdoutFile: "/tmp/test-logs/proc_1-stdout.log",
      stderrFile: "/tmp/test-logs/proc_1-stderr.log",
      combinedFile: "/tmp/test-logs/proc_1-combined.log",
    });

    expect(fs.existsSync(paths.stdoutFile)).toBe(true);
    expect(fs.existsSync(paths.stderrFile)).toBe(true);
    expect(fs.existsSync(paths.combinedFile)).toBe(true);
  });

  it("appends stdout data", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    store.appendStdout(paths.stdoutFile, Buffer.from("hello\n"));

    const content = fs.readFileSync(paths.stdoutFile, "utf-8");
    expect(content).toBe("hello\n");
  });

  it("appends stderr data", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    store.appendStderr(paths.stderrFile, Buffer.from("error\n"));

    const content = fs.readFileSync(paths.stderrFile, "utf-8");
    expect(content).toBe("error\n");
  });

  it("appends combined lines with stream tag", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    store.appendCombinedLine(paths.combinedFile, "stdout", "out line");
    store.appendCombinedLine(paths.combinedFile, "stderr", "err line");

    const content = fs.readFileSync(paths.combinedFile, "utf-8");
    expect(content).toBe("1:out line\n2:err line\n");
  });

  it("appends error lines", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    store.appendErrorLine(paths.stderrFile, "Spawn error: missing pid");

    const content = fs.readFileSync(paths.stderrFile, "utf-8");
    expect(content).toBe("Spawn error: missing pid\n");
  });

  it("readTailLines returns last N lines", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "line1\nline2\nline3\nline4\nline5\n");

    expect(store.readTailLines(paths.stdoutFile, 3)).toEqual([
      "line3",
      "line4",
      "line5",
    ]);
  });

  it("readTailLines returns all lines when fewer than N", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "only\nline\n");

    expect(store.readTailLines(paths.stdoutFile, 10)).toEqual(["only", "line"]);
  });

  it("readTailLines returns empty array for missing file", () => {
    using store = new ProcessLogStore("/tmp/test-logs");

    expect(store.readTailLines("/nonexistent", 10)).toEqual([]);
  });

  it("readTailLines handles files without a trailing newline", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "line1\nline2\nline3");

    expect(store.readTailLines(paths.stdoutFile, 2)).toEqual([
      "line2",
      "line3",
    ]);
  });

  it("readTailLines preserves a leading empty line without duplication", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");
    fs.writeFileSync(paths.stdoutFile, "\nhello\n");

    expect(store.readTailLines(paths.stdoutFile, 3)).toEqual(["", "hello"]);
  });

  it("readTailLines handles empty and zero-line requests", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    expect(store.readTailLines(paths.stdoutFile, 10)).toEqual([]);
    fs.writeFileSync(paths.stdoutFile, "line\n");
    expect(store.readTailLines(paths.stdoutFile, 0)).toEqual([]);
  });

  it("readTailLines handles an exact chunk boundary", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");
    const prefix = "x".repeat(64 * 1024 - "\nlast\n".length);
    fs.writeFileSync(paths.stdoutFile, `${prefix}\nlast\n`);

    expect(store.readTailLines(paths.stdoutFile, 1)).toEqual(["last"]);
  });

  it("readTailLines reads the tail of a multi-megabyte numbered file", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");
    const lines = Array.from(
      { length: 500_000 },
      (_, index) => `line-${String(index).padStart(6, "0")}`,
    );
    fs.writeFileSync(paths.stdoutFile, `${lines.join("\n")}\n`);

    expect(store.readTailLines(paths.stdoutFile, 10)).toEqual(lines.slice(-10));
  });

  it("readTailLines bounds a tail containing one huge line", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");
    fs.writeFileSync(paths.stdoutFile, "x".repeat(3 * 1024 * 1024));

    const result = store.readTailLines(paths.stdoutFile, 10);

    expect(result).toHaveLength(1);
    expect(result[0]?.startsWith("[… truncated] ")).toBe(true);
    expect(Buffer.byteLength(result[0] ?? "")).toBeLessThanOrEqual(
      MAX_TAIL_READ_BYTES + Buffer.byteLength("[… truncated] "),
    );
  });

  it("readTailLines retains a marked huge line ending in newline", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");
    fs.writeFileSync(paths.stdoutFile, `${"x".repeat(3 * 1024 * 1024)}\n`);

    const result = store.readTailLines(paths.stdoutFile, 1);

    expect(result).toHaveLength(1);
    expect(result[0]?.startsWith("[… truncated] ")).toBe(true);
  });

  it("readTailLines bounds decoded invalid UTF-8 output", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");
    fs.writeFileSync(
      paths.stdoutFile,
      Buffer.alloc(MAX_TAIL_READ_BYTES + 1, 0xff),
    );

    const result = store.readTailLines(paths.stdoutFile, 1);

    expect(Buffer.byteLength(result[0] ?? "")).toBeLessThanOrEqual(
      MAX_TAIL_READ_BYTES + Buffer.byteLength("[… truncated] "),
    );
  });

  it("readTailLines keeps final lines after invalid UTF-8 output", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");
    fs.writeFileSync(
      paths.stdoutFile,
      Buffer.concat([
        Buffer.alloc(MAX_TAIL_READ_BYTES - 32, 0xff),
        Buffer.from("\npenultimate\nlast\n"),
      ]),
    );

    expect(store.readTailLines(paths.stdoutFile, 2)).toEqual([
      "penultimate",
      "last",
    ]);
  });

  it("readFullFile returns entire content", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "full content here");

    expect(store.readFullFile(paths.stdoutFile)).toBe("full content here");
  });

  it("readFullFile returns empty string for missing file", () => {
    using store = new ProcessLogStore("/tmp/test-logs");

    expect(store.readFullFile("/nonexistent")).toBe("");
  });

  it("readFullFile returns a marked bounded suffix for large files", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");
    fs.writeFileSync(paths.stdoutFile, "x".repeat(MAX_TAIL_READ_BYTES * 8 + 1));

    const content = store.readFullFile(paths.stdoutFile);

    expect(content.startsWith(`[… truncated, see ${paths.stdoutFile}]\n`)).toBe(
      true,
    );
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(
      MAX_TAIL_READ_BYTES * 8,
    );
  });

  it("getCombinedOutput parses tagged lines", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(
      paths.combinedFile,
      "1:stdout line\n2:stderr line\n1:another out\n",
    );

    expect(store.getCombinedOutput(paths.combinedFile, 100)).toEqual([
      { type: "stdout", text: "stdout line" },
      { type: "stderr", text: "stderr line" },
      { type: "stdout", text: "another out" },
    ]);
  });

  it("getFileSize returns file sizes", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "12345");
    fs.writeFileSync(paths.stderrFile, "abc");

    expect(store.getFileSize(paths)).toEqual({ stdout: 5, stderr: 3 });
  });

  it("getFileSize returns zeros for missing files", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = {
      stdoutFile: "/nonexistent-stdout",
      stderrFile: "/nonexistent-stderr",
      combinedFile: "/nonexistent-combined",
    };

    expect(store.getFileSize(paths)).toEqual({ stdout: 0, stderr: 0 });
  });

  it("removeLogs deletes log files", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    const paths = store.createLogs("proc_1");

    fs.writeFileSync(paths.stdoutFile, "data");
    fs.writeFileSync(paths.stderrFile, "data");
    fs.writeFileSync(paths.combinedFile, "data");

    assert(
      fs.existsSync(paths.stdoutFile) &&
        fs.existsSync(paths.stderrFile) &&
        fs.existsSync(paths.combinedFile),
      "files should exist before removal",
    );

    store.removeLogs(paths);

    expect(fs.existsSync(paths.stdoutFile)).toBe(false);
    expect(fs.existsSync(paths.stderrFile)).toBe(false);
    expect(fs.existsSync(paths.combinedFile)).toBe(false);
  });

  it("cleanup removes log directory", () => {
    using store = new ProcessLogStore("/tmp/test-logs");
    store.createLogs("proc_1");

    assert(
      fs.existsSync("/tmp/test-logs"),
      "log dir should exist before cleanup",
    );

    store.cleanup();

    expect(fs.existsSync("/tmp/test-logs")).toBe(false);
  });

  describe("lazy log directory creation", () => {
    const piProcessesDirs = (): string[] => {
      try {
        return fs
          .readdirSync(tmpdir())
          .map((name) => String(name))
          .filter((name) => name.startsWith("pi-processes-"));
      } catch (_error) {
        return [];
      }
    };

    it("does not create a temp directory until the store is used", () => {
      const before = piProcessesDirs();

      {
        using _store = new ProcessLogStore();
        // Constructing the store must not touch the filesystem.
        expect(piProcessesDirs().filter((d) => !before.includes(d))).toEqual(
          [],
        );
      }

      // Disposing an unused store leaves nothing behind.
      expect(piProcessesDirs().filter((d) => !before.includes(d))).toEqual([]);
    });

    it("creates and removes the directory around createLogs", () => {
      using store = new ProcessLogStore();
      const dir = store.getLogDir();

      expect(fs.existsSync(dir)).toBe(true);

      store.cleanup();

      expect(fs.existsSync(dir)).toBe(false);
      // The store is reusable after cleanup.
      const next = store.getLogDir();
      expect(fs.existsSync(next)).toBe(true);
      expect(next).not.toEqual(dir);
    });
  });

  describe("per-file size cap", () => {
    it("truncates a stream file once it exceeds the cap", () => {
      using store = new ProcessLogStore("/tmp/test-logs", {
        maxFileBytes: 4096,
      });
      const paths = store.createLogs("proc_1");

      for (let index = 0; index < 2000; index++) {
        store.appendStdout(paths.stdoutFile, Buffer.from("hello world\n"));
      }

      const size = store.getFileSize(paths).stdout;
      expect(size).toBeLessThanOrEqual(4096);

      const content = fs.readFileSync(paths.stdoutFile, "utf-8") as string;
      expect(content.startsWith("[log truncated at 64 MB")).toBe(true);
    });

    it("keeps recent lines readable after truncation", () => {
      using store = new ProcessLogStore("/tmp/test-logs", {
        maxFileBytes: 4096,
      });
      const paths = store.createLogs("proc_1");

      for (let index = 0; index < 2000; index++) {
        store.appendCombinedLine(paths.combinedFile, "stdout", `line-${index}`);
      }
      store.appendCombinedLine(paths.combinedFile, "stdout", "final line");

      const tail = store.readTailLines(paths.combinedFile, 10000);
      expect(tail).toContain("1:final line");

      const combined = store.getCombinedOutput(paths.combinedFile, 10000);
      const marker = combined.find((entry) => entry.type === "stderr");
      expect(marker?.text).toMatch(/log truncated at 64 MB/);
    });

    it("writes a single oversized append as marker plus the entry", () => {
      using store = new ProcessLogStore("/tmp/test-logs", {
        maxFileBytes: 4096,
      });
      const paths = store.createLogs("proc_1");

      const big = Buffer.from("x".repeat(8000));
      store.appendStdout(paths.stdoutFile, big);

      const size = store.getFileSize(paths).stdout;
      const markerBytes = Buffer.byteLength(
        "[log truncated at 64 MB — earlier output discarded]\n",
      );
      expect(size).toBe(markerBytes + 8000);

      const content = fs.readFileSync(paths.stdoutFile, "utf-8") as string;
      expect(content.startsWith("[log truncated at 64 MB")).toBe(true);
      expect(content.endsWith("x".repeat(8000))).toBe(true);
    });

    it("seeds the counter from pre-existing file content", () => {
      fs.mkdirSync("/tmp/test-logs", { recursive: true });
      fs.writeFileSync("/tmp/test-logs/proc_1-stdout.log", "x".repeat(4000));

      using store = new ProcessLogStore("/tmp/test-logs", {
        maxFileBytes: 4096,
      });
      const paths = store.createLogs("proc_1");

      // 4000 pre-existing + 200 new would breach the 4096 cap, so the file is
      // truncated and restarted from the marker.
      store.appendStdout(paths.stdoutFile, Buffer.from("y".repeat(200)));

      const size = store.getFileSize(paths).stdout;
      expect(size).toBeLessThanOrEqual(4096);

      const content = fs.readFileSync(paths.stdoutFile, "utf-8") as string;
      expect(content.startsWith("[log truncated at 64 MB")).toBe(true);
    });
  });
});
