import { assert, expect } from "vitest";
import { ProcessManager } from "../../src/manager";
import { spawnCommand } from "../../src/utils/command-executor";
import { test } from "./fixtures";
import { waitForEnd } from "./utils";

function waitForOutput(
  child: ReturnType<typeof spawnCommand>,
  marker: string,
  stream: "stdout" | "stderr" = "stdout",
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for marker "${marker}"`));
    }, 5000);

    const onData = (data: Buffer) => {
      chunks.push(data);
      if (!Buffer.concat(chunks).toString("utf8").includes(marker)) return;
      clearTimeout(timeout);
      if (stream === "stdout") child.stdout?.off("data", onData);
      else child.stderr?.off("data", onData);
      resolve(Buffer.concat(chunks));
    };
    if (stream === "stdout") child.stdout?.on("data", onData);
    else child.stderr?.on("data", onData);
  });
}

test("adopts a real running child and captures output across handover", async ({
  cwd,
  addFile,
}) => {
  using manager = new ProcessManager();

  const command = "echo pre; until [ -f go ]; do sleep 0.05; done; echo post";
  const child = spawnCommand(command, cwd);

  // Play the adopter: capture foreground output by stream, then hand the
  // child over.
  const initialStdout = await waitForOutput(child, "pre");

  const info = manager.adopt("adopted", command, cwd, child, {
    initialStdout,
    startTime: Date.now() - 10_000,
  });
  expect(info.status).toBe("running");
  expect(info.pid).toBe(child.pid);

  addFile("go");
  const ended = await waitForEnd(manager, info.id);
  expect(ended.exitCode).toBe(0);
  expect(ended.success).toBe(true);

  const output = manager.getOutput(info.id);
  assert(output, "output should exist");
  const preIndex = output.stdout.indexOf("pre");
  const postIndex = output.stdout.indexOf("post");
  expect(preIndex).toBeGreaterThanOrEqual(0);
  expect(postIndex).toBeGreaterThan(preIndex);
});

test("kills an adopted child via process-group kill", async ({ cwd }) => {
  using manager = new ProcessManager();

  const child = spawnCommand("sleep 30", cwd);
  const info = manager.adopt("adopted-kill", "sleep 30", cwd, child);

  const result = await manager.kill(info.id, { signal: "SIGKILL" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.info.status).toBe("killed");
  }
});

test("routes initialStderr to the stderr log across handover", async ({
  cwd,
  addFile,
}) => {
  using manager = new ProcessManager();

  const command =
    "echo pre-err 1>&2; until [ -f go ]; do sleep 0.05; done; echo post-err 1>&2";
  const child = spawnCommand(command, cwd);

  const initialStderr = await waitForOutput(child, "pre-err", "stderr");

  const info = manager.adopt("adopted-stderr", command, cwd, child, {
    initialStderr,
    startTime: Date.now() - 5_000,
  });
  expect(info.status).toBe("running");

  addFile("go");
  const ended = await waitForEnd(manager, info.id);
  expect(ended.exitCode).toBe(0);

  const output = manager.getOutput(info.id);
  assert(output, "output should exist");
  const preIndex = output.stderr.indexOf("pre-err");
  const postIndex = output.stderr.indexOf("post-err");
  expect(preIndex).toBeGreaterThanOrEqual(0);
  expect(postIndex).toBeGreaterThan(preIndex);
  // pre-handover stderr must not leak into the stdout log
  expect(output.stdout.indexOf("pre-err")).toBe(-1);
});
