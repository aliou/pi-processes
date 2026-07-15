import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import type { ProcessInfo } from "../../../../src/types";
import type { ListProcess } from ".";
import { buildCollapsed, formatExpandedProcessLines } from "./render";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function makeProcess(overrides: Partial<ListProcess> = {}): ListProcess {
  const process: ProcessInfo = {
    id: "proc_1",
    name: "dev",
    pid: 123,
    command: "pnpm dev",
    cwd: "/repo",
    startTime: 1000,
    endTime: null,
    status: "running",
    exitCode: null,
    success: null,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: null,
    signal: null,
    errorMessage: null,
  };

  return { ...process, duration: "5s", watches: [], ...overrides };
}

describe("formatExpandedProcessLines", () => {
  it("renders colored two-line rows with watch continuations", () => {
    const lines = formatExpandedProcessLines(
      [
        makeProcess({
          cwd: `${homedir()}/repo`,
          watches: [
            { pattern: "ready|started" },
            { pattern: "ERROR\nretry with a long suffix that is truncated" },
          ],
        }),
      ],
      theme,
      80,
    );

    expect(lines[0]).toBe(
      "dev pid: 123 running 5s (1970-01-01 00:00:01) proc_1",
    );
    expect(lines[1]).toContain("$ pnpm dev");
    expect(lines[2]).toContain("cwd ~/repo");
    expect(lines[3]).toContain("↳ [both] ready|started");
    expect(lines[4]).toContain("↳ [both] ERROR\\nretry");
  });

  it("uses the render width instead of a fixed truncation width", () => {
    const process = makeProcess({
      command: "a command that is deliberately longer than narrow terminals",
      watches: [{ pattern: "a watch that is also deliberately very long" }],
    });

    for (const width of [80, 40, 20]) {
      const lines = formatExpandedProcessLines([process], theme, width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("shows the active watch count when collapsed", () => {
    const component = buildCollapsed(
      {
        action: "list",
        processes: [
          makeProcess({ watches: [{ pattern: "ready" }, { pattern: "fail" }] }),
        ],
        filters: { limit: null, sortBy: "startTime_desc", statuses: ["all"] },
        counts: { running: 1, exited: 0, failed: 0, killed: 0, total: 1 },
      },
      theme,
    );

    expect(component.render(100).join("\n")).toContain("2 watches");
  });
});
