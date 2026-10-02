import { describe, expect, it } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import type { NotifyConfig } from "../notifications/registry";
import { buildOutputStructuredContent } from "./output";
import {
  type ClearDetails,
  type ListDetails,
  type ListProcess,
  type OutputDetails,
  type ProcessToolOutput,
  ProcessToolOutputSchema,
  type StartDetails,
  type StopDetails,
  type UpdateDetails,
  type WriteDetails,
} from "./schema";

function runningProcess(): ProcessInfo {
  return {
    id: "proc_ab12",
    name: "dev-server",
    pid: 1234,
    command: "pnpm dev",
    cwd: "/repo",
    startTime: 1_700_000_000_000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/proc_ab12/stdout.log",
    stderrFile: "/tmp/proc_ab12/stderr.log",
    endReason: null,
    signal: null,
    errorMessage: null,
  };
}

const notify: NotifyConfig = {
  onSuccess: "turn",
  onFailure: "turn",
  onKilled: "context",
  logMatches: [],
};

describe("ProcessToolOutputSchema", () => {
  it("discriminates every process action exactly once", () => {
    const members = (
      ProcessToolOutputSchema as {
        anyOf: Array<{
          properties: { action: { const: string } };
        }>;
      }
    ).anyOf.map((member) => member.properties.action.const);

    expect([...members].sort()).toEqual(
      ["start", "list", "stop", "output", "write", "update", "clear"].sort(),
    );
  });

  it("keeps every non-output details object assignable to the union", () => {
    // Regression: structured output drifted from details types (#120).
    const mirrored: readonly ProcessToolOutput[] = [
      {
        action: "start",
        process: runningProcess(),
        notify,
      } satisfies StartDetails,
      {
        action: "stop",
        result: { ok: true, info: runningProcess() },
      } satisfies StopDetails,
      {
        action: "stop",
        result: {
          ok: false,
          info: runningProcess(),
          reason: "timeout",
        },
      } satisfies StopDetails,
      {
        action: "list",
        processes: [
          {
            ...runningProcess(),
            duration: "10m",
            watches: [{ pattern: "ready", mode: "literal" }],
          } satisfies ListProcess,
        ],
        filters: { limit: null, sortBy: "startTime_desc", statuses: ["all"] },
        counts: { running: 1, exited: 0, failed: 0, killed: 0, total: 1 },
      } satisfies ListDetails,
      {
        action: "write",
        id: "proc_ab12",
        processName: "dev-server",
        process: null,
        bytes: 12,
        end: false,
        ok: true,
        reason: null,
      } satisfies WriteDetails,
      {
        action: "update",
        ok: true,
        process: runningProcess(),
        renamed: true,
        previousName: "server",
        watches: {
          mode: "append",
          before: [{ pattern: "ready" }],
          applied: [{ pattern: "error", mode: "literal" }],
          count: 2,
          items: [],
        },
      } satisfies UpdateDetails,
      { action: "clear", cleared: 2 } satisfies ClearDetails,
    ];

    expect(mirrored).toHaveLength(7);
  });
});

describe("buildOutputStructuredContent", () => {
  it("attaches the raw filtered selection lines to the output details", () => {
    const details: OutputDetails = {
      action: "output",
      id: "proc_ab12",
      processName: "dev-server",
      processStatus: "running",
      stream: "both",
      tailLines: 100,
      pattern: "ready",
      mode: "literal",
      stdoutFile: "/tmp/proc_ab12/stdout.log",
      stderrFile: "/tmp/proc_ab12/stderr.log",
    };
    const selection = {
      stdout: ["ready in \u001b[32m112ms\u001b[0m"],
      stderr: [],
    };

    expect(buildOutputStructuredContent(details, selection)).toEqual({
      ...details,
      stdout: selection.stdout,
      stderr: selection.stderr,
    });
  });

  it("passes preview truncation metadata through without trimming the line arrays", () => {
    const details: OutputDetails = {
      action: "output",
      id: "proc_ab12",
      processName: "dev-server",
      processStatus: "running",
      stream: "both",
      tailLines: 2000,
      pattern: null,
      mode: "literal",
      stdoutFile: "/tmp/proc_ab12/stdout.log",
      stderrFile: "/tmp/proc_ab12/stderr.log",
      truncation: {
        truncated: true,
        truncatedBy: "bytes",
        totalLines: 3000,
        totalBytes: 80_000,
        outputLines: 2000,
        outputBytes: 50_000,
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines: 2000,
        maxBytes: 50_000,
      },
    };
    const selection = {
      stdout: Array.from({ length: 2000 }, (_, i) => `line ${i}`),
      stderr: [],
    };

    const output = buildOutputStructuredContent(details, selection);

    expect(output.stdout).toHaveLength(2000);
    expect(output.truncation).toEqual(details.truncation);
  });
});
