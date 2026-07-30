import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProcessManager } from "../../manager";
import { executeStart } from "./start";

function failingChild(error: Error): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    stdin: null,
    stdout: null,
    stderr: null,
    unref: () => child,
  });
  process.nextTick(() => child.emit("error", error));
  return child as unknown as ChildProcess;
}

function resultText(result: Awaited<ReturnType<typeof executeStart>>): string {
  return result.content.map((part) => part.text).join("\n");
}

describe("executeStart", () => {
  let manager: ProcessManager;
  let existingCwd: string;
  let context: ExtensionContext;

  beforeEach(() => {
    existingCwd = mkdtempSync(join(tmpdir(), "pi-processes-start-"));
    context = { cwd: existingCwd } as ExtensionContext;
  });

  afterEach(() => {
    manager?.cleanup();
    rmSync(existingCwd, { recursive: true, force: true });
  });

  it("returns a failed tool result for an asynchronous spawn error", async () => {
    manager = new ProcessManager({
      spawnCommand: () =>
        failingChild(new Error("spawn /bin/bash ENOENT: missing cwd")),
    });

    const result = await executeStart(
      { name: "broken", command: "true" },
      manager,
      context,
    );
    const text = resultText(result);

    expect(result.details.success).toBe(false);
    expect(result.details.process?.error).toContain("ENOENT");
    expect(text).toContain("Failed to start");
    expect(text).toContain("ENOENT");
    expect(text).not.toContain("Started");
    expect(text).not.toContain("PID: -1");
  });

  it("reports a missing cwd as an ordinary failed result", async () => {
    manager = new ProcessManager();

    const result = await executeStart(
      {
        name: "missing-cwd",
        command: "true",
        cwd: join(existingCwd, "missing"),
      },
      manager,
      context,
    );

    expect(result.details.success).toBe(false);
    expect(result.details.process?.status).toBe("exited");
    expect(resultText(result)).toContain("ENOENT");
    expect(resultText(result)).not.toContain("Started");
    expect(resultText(result)).not.toContain("PID: -1");
  });

  it("preserves successful starts with an existing cwd", async () => {
    manager = new ProcessManager();

    const result = await executeStart(
      { name: "working", command: "sleep 0.1" },
      manager,
      context,
    );

    expect(result.details.success).toBe(true);
    expect(result.details.process?.pid).toBeGreaterThan(0);
    expect(result.details.process?.error).toBeNull();
    expect(resultText(result)).toContain("Started");
  });
});
