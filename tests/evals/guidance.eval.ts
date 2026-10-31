import { expect } from "vitest";
import { describeEval } from "vitest-evals";

import {
  callsWithAction,
  createProcessesHarness,
  watchPatternsForStartedProcess,
} from "./harness";

const harness = createProcessesHarness("guidance");

function isShellBackground(command: string): boolean {
  const stripped = command.replace(/&&|\d?>&\d?|&>/g, "");
  return stripped.includes("&") || /\b(nohup|setsid|disown)\b/.test(command);
}

describeEval("process tool guidance", { harness }, (it) => {
  it("starts a server with process start instead of shell backgrounding", async ({
    run,
  }) => {
    const result = await run(
      "Start the docs server `bash -c 'echo serving docs; sleep 600'` so it keeps running while we continue working. Then tell me it is up.",
    );
    const { activeTools, toolCalls, bashCommands } = result.output;

    expect(activeTools).toContain("process");
    expect(result.output.successfulStarts).toBe(1);
    const starts = callsWithAction(toolCalls, "start");
    expect(starts).toHaveLength(1);
    expect(String(starts[0]?.arguments.command)).toContain("serving docs");
    expect(bashCommands.filter(isShellBackground)).toEqual([]);
  });

  it("ends its turn after starting a long build instead of waiting", async ({
    run,
  }) => {
    const result = await run(
      "Run the release build `bash -c 'sleep 45; echo build ok'` in the background and tell me the result when it finishes.",
    );
    const { activeTools, toolCalls, bashCommands } = result.output;

    expect(activeTools).toContain("process");
    expect(result.output.successfulStarts).toBe(1);
    expect(callsWithAction(toolCalls, "start")).toHaveLength(1);
    expect(callsWithAction(toolCalls, "output")).toEqual([]);
    expect(callsWithAction(toolCalls, "list")).toEqual([]);
    expect(bashCommands).toEqual([]);
  });

  it("uses a log watch for readiness instead of polling output", async ({
    run,
  }) => {
    const result = await run(
      "Start the dev server `bash -c 'sleep 20; echo \"Listening on http://localhost:4000\"; sleep 600'`. I want to know as soon as it is listening; I will be doing other work meanwhile.",
    );
    const { activeTools, toolCalls, bashCommands } = result.output;

    expect(activeTools).toContain("process");
    expect(result.output.successfulStarts).toBe(1);
    const starts = callsWithAction(toolCalls, "start");
    expect(starts).toHaveLength(1);
    expect(
      watchPatternsForStartedProcess(result.output.processResults).some(
        (pattern) => /listening/i.test(pattern),
      ),
    ).toBe(true);
    expect(callsWithAction(toolCalls, "output")).toEqual([]);
    expect(bashCommands).toEqual([]);
  });

  it("picks context attention for a clean exit and turn for failure", async ({
    run,
  }) => {
    const result = await run(
      "Start the background worker `bash -c 'sleep 600'` named sync-worker. If it exits cleanly, there is no need to interrupt what you are doing; just make sure you know about it later. If it crashes, interrupt me immediately.",
    );
    const { activeTools, toolCalls } = result.output;

    expect(activeTools).toContain("process");
    expect(result.output.successfulStarts).toBe(1);
    const starts = callsWithAction(toolCalls, "start");
    expect(starts).toHaveLength(1);
    const notify = starts[0]?.arguments.notify as
      | { onSuccess?: string; onFailure?: string }
      | undefined;
    expect(notify?.onSuccess).toBe("context");
    expect(notify?.onFailure ?? "turn").toBe("turn");
  });

  it("fixes a noisy watch with process update instead of restarting", async ({
    run,
  }) => {
    const result = await run([
      {
        type: "prompt",
        content:
          "Start `bash -c 'sleep 30; while true; do echo tick; sleep 2; done'` named ticker with a log watch on the literal pattern `tick`. Then end your turn.",
      },
      {
        type: "prompt",
        content:
          "The tick watch on ticker is far too noisy. From now on I only care about lines containing FATAL.",
      },
    ]);
    const { activeTools, toolCalls } = result.output;

    expect(activeTools).toContain("process");
    expect(result.output.successfulStarts).toBe(1);
    expect(callsWithAction(toolCalls, "start").length).toBeGreaterThan(0);
    expect(callsWithAction(toolCalls, "stop")).toEqual([]);
    expect(
      watchPatternsForStartedProcess(result.output.processResults, true).some(
        (pattern) => pattern.includes("FATAL"),
      ),
    ).toBe(true);
    const actions = toolCalls.map((call) => call.arguments.action);
    expect(actions.lastIndexOf("start")).toBeLessThan(
      actions.indexOf("update"),
    );
  });
});
