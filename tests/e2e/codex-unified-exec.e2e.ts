import { assert, expect } from "vitest";

import { SessionManager } from "../../extensions/codex-unified-exec/session";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";

test("exec_command runs a short-lived command and returns its output + exit code", async ({
  cwd,
}) => {
  using manager = getManager();
  using sessions = new SessionManager(manager);

  const out = await sessions.execCommand({
    cmd: "printf 'hello\\n'; exit 0",
    cwd,
    yield_time_ms: 1000,
  });

  expect(out.exitCode).toBe(0);
  expect(out.processId).toBe(null); // exited -> released
  // Login bash appends a terminal-title escape (\e]0;\a) on exit; codex's
  // raw byte capture includes it too, so assert the payload prefix only.
  expect(out.rawOutput.toString("utf8")).toMatch(/^hello\n/);
  expect(out.chunkId).toMatch(/^[0-9a-f]{6}$/);
  expect(out.originalTokenCount).toBeGreaterThan(0);
});

test("exec_command captures output without a trailing newline (raw bytes, not line-buffered)", async ({
  cwd,
}) => {
  using manager = getManager();
  using sessions = new SessionManager(manager);

  // `printf partial` emits no newline. The raw-byte tap captures it
  // immediately; the line-based process_output_changed path would hold it as a
  // pending line until a newline or flush.
  const out = await sessions.execCommand({
    cmd: "printf 'partial'; exit 0",
    cwd,
    yield_time_ms: 1000,
  });

  expect(out.exitCode).toBe(0);
  expect(out.rawOutput.toString("utf8")).toMatch(/^partial/);
});

test("exec_command keeps a long-running session and write_stdin drives it", async ({
  cwd,
}) => {
  using manager = getManager();
  using sessions = new SessionManager(manager);

  const started = await sessions.execCommand({
    cmd: "IFS= read -r a; printf 'got:%s\\n' \"$a\"; IFS= read -r b; printf 'done\\n'; exit 0",
    cwd,
    yield_time_ms: 500,
  });
  // Blocks on the first `read`; no output yet -> alive, no exit code.
  assert(started.processId !== null, "session should be alive");
  const sessionId = started.processId;
  expect(started.exitCode).toBe(null);
  expect(started.rawOutput.toString("utf8")).toBe("");

  const first = await sessions.writeStdin({
    session_id: sessionId,
    chars: "foo\n",
    yield_time_ms: 1000,
  });
  expect(first.rawOutput.toString("utf8")).toMatch(/got:foo\n/);
  expect(first.processId).toBe(sessionId); // still alive
  expect(first.exitCode).toBe(null);

  const second = await sessions.writeStdin({
    session_id: sessionId,
    chars: "bar\n",
    yield_time_ms: 2000,
  });
  expect(second.exitCode).toBe(0);
  expect(second.processId).toBe(null); // exited -> released
  expect(second.rawOutput.toString("utf8")).toMatch(/^done\n/);

  // Reusing a released session id is an error (codex UnknownProcessId).
  await expect(
    sessions.writeStdin({
      session_id: sessionId,
      chars: "late\n",
      yield_time_ms: 500,
    }),
  ).rejects.toThrow(/unknown session id/);
});
