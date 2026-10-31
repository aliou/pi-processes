import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import type { NotifyConfig } from "../notifications/registry";
import { buildOutputStructuredContent } from "./output";
import {
  type ClearDetails,
  type ListDetails,
  type ListProcess,
  type OutputDetails,
  ProcessesParams,
  type ProcessToolOutput,
  ProcessToolOutputDeclaration,
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

function propertyPaths(schema: unknown, path = ""): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) =>
      propertyPaths(item, `${path}[${index}]`),
    );
  }
  if (typeof schema !== "object" || schema === null) return [];
  return Object.entries(schema).flatMap(([keyword, value]) => {
    if (keyword !== "properties") return propertyPaths(value, path);
    return Object.entries(value).flatMap(([name, child]) => [
      `${path}.${name}`,
      ...propertyPaths(child, `${path}.${name}`),
    ]);
  });
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

describe("ProcessesParams", () => {
  const update = (items: unknown[]) => ({
    action: "update",
    id: "proc_ab12",
    watches: { mode: "remove", items },
  });

  it("keeps update watch fields optional and validated", () => {
    expect(Value.Check(ProcessesParams, update([{ index: 0 }]))).toBe(true);
    expect(
      Value.Check(
        ProcessesParams,
        update([{ pattern: "FATAL", mode: "literal", on: "turn" }]),
      ),
    ).toBe(true);
    expect(Value.Check(ProcessesParams, update([{ mode: "glob" }]))).toBe(
      false,
    );
    expect(Value.Check(ProcessesParams, update([{ on: "later" }]))).toBe(false);
  });

  it("describes update watch fields once, under notify.logMatches", () => {
    const fields = JSON.parse(JSON.stringify(ProcessesParams)).properties
      .watches.properties.items.items.properties;

    for (const name of ["mode", "stream", "repeat", "on"]) {
      expect(fields[name]).not.toHaveProperty("description");
    }
  });
});

describe("ProcessToolOutputDeclaration", () => {
  it("omits descriptions, length limits, and integer constraints", () => {
    const declaration = JSON.stringify(ProcessToolOutputDeclaration);

    expect(declaration).not.toMatch(/"description":"/);
    expect(declaration).not.toMatch(/"maxItems"|"maxLength"|"integer"/);
  });

  it("keeps every field of the output schema", () => {
    const fields = propertyPaths(ProcessToolOutputDeclaration);

    expect(fields).toEqual(propertyPaths(ProcessToolOutputSchema));
    expect(
      fields.some((field) => field.endsWith(".signal[0].description")),
    ).toBe(true);
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
