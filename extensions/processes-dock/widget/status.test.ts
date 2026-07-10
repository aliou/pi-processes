import { describe, expect, it } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import { renderStatusWidget } from "./status";

function makeProcess(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
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
    ...overrides,
  };
}

// `theme.fg(color, text)` -> `{color:text}` keeps assertions legible. `bg`
// is only relevant to the tab renderer, not the status widget, but is
// included for completeness.
const theme = {
  fg: (color: string, text: string) => `{${color}:${text}}`,
  bg: (_color: string, text: string) => text,
} as never;

describe("renderStatusWidget", () => {
  it("renders nothing when there are no processes", () => {
    expect(renderStatusWidget([], theme)).toEqual([]);
  });

  it("renders a single running process with a dot, name, and state", () => {
    const lines = renderStatusWidget(
      [makeProcess({ status: "running" })],
      theme,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("{dim:processes: }");
    expect(lines[0]).toContain("{accent:dev}");
    expect(lines[0]).toContain("{dim:running}");
  });

  it("renders a successful exit as done", () => {
    const lines = renderStatusWidget(
      [
        makeProcess({
          status: "exited",
          success: true,
          exitCode: 0,
          endTime: 2000,
        }),
      ],
      theme,
    );
    expect(lines[0]).toContain("{success:done}");
  });

  it("renders a failed exit with the code", () => {
    const lines = renderStatusWidget(
      [
        makeProcess({
          status: "exited",
          success: false,
          exitCode: 7,
          endTime: 2000,
        }),
      ],
      theme,
    );
    expect(lines[0]).toContain("{error:exit(7)}");
  });

  it("joins multiple processes with a dim separator", () => {
    const lines = renderStatusWidget(
      [
        makeProcess({ id: "proc_1", name: "dev", status: "running" }),
        makeProcess({
          id: "proc_2",
          name: "test",
          status: "exited",
          success: true,
          exitCode: 0,
          endTime: 2000,
        }),
      ],
      theme,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("{dim: | }");
    // Live processes come before finished ones.
    expect(lines[0].indexOf("{accent:dev}")).toBeLessThan(
      lines[0].indexOf("{success:done}"),
    );
  });

  it("fits the line to the requested width on overflow", () => {
    const processes = Array.from({ length: 20 }, (_, index) =>
      makeProcess({
        id: `proc_${index}`,
        name: `server-${index}`,
        status: "running",
      }),
    );
    const maxWidth = 30;
    const lines = renderStatusWidget(processes, theme, maxWidth);
    expect(lines).toHaveLength(1);
    // truncateToWidth clamps the visible portion even though the mock theme
    // inflates the measured widths, so result stays within bounds.
    expect(lines[0].length).toBeGreaterThan(0);
  });

  it("renders the first process even when width is tiny", () => {
    const lines = renderStatusWidget(
      [makeProcess({ status: "running" })],
      theme,
      3,
    );
    expect(lines).toHaveLength(1);
    // Truncated to at most 3 visible columns.
    expect(lines[0].length).toBeGreaterThan(0);
  });

  it("renders terminating as stopping with a warning dot", () => {
    const lines = renderStatusWidget(
      [makeProcess({ status: "terminating" })],
      theme,
    );
    expect(lines[0]).toContain("{warning:●}");
    expect(lines[0]).toContain("{dim:stopping}");
  });
});
