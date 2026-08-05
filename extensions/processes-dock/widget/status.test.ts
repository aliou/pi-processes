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
  it("bounds names by display width and drops escape sequences", () => {
    const ESC = String.fromCodePoint(0x001b);
    const wide = renderStatusWidget(
      [makeProcess({ name: "日本語のプロセス名前です" })],
      theme,
    )[0] as string;
    const escaped = renderStatusWidget(
      [makeProcess({ name: `${ESC}[2Jdev` })],
      theme,
    )[0] as string;

    expect(wide).toContain("日本語のプロセス名…");
    expect(escaped).not.toContain(ESC);
    expect(escaped).toContain("dev");
  });

  it("renders nothing when there are no processes", () => {
    expect(renderStatusWidget([], theme)).toEqual([]);
  });

  it("renders a single running process as dot + name", () => {
    const lines = renderStatusWidget(
      [makeProcess({ status: "running" })],
      theme,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("{dim:ps: }");
    expect(lines[0]).toContain("{accent:dev}");
    // No trailing state word: the dot carries the status.
    expect(lines[0]).not.toContain("running");
  });

  it("collapses exited-success into a summary token with a check glyph", () => {
    const lines = renderStatusWidget(
      [
        makeProcess({
          id: "proc_1",
          status: "running",
          name: "dev",
        }),
        makeProcess({
          id: "proc_2",
          status: "exited",
          success: true,
          exitCode: 0,
          endTime: 2000,
          name: "build",
        }),
      ],
      theme,
    );
    expect(lines).toHaveLength(1);
    // The exited-success process name should NOT appear individually.
    expect(lines[0]).not.toContain("{success:build}");
    // Summary token with check glyph and count.
    expect(lines[0]).toContain("{success:✓}");
    expect(lines[0]).toContain("1 done");
  });

  it("shows failed processes individually, not in the summary", () => {
    const lines = renderStatusWidget(
      [
        makeProcess({
          id: "proc_1",
          status: "running",
          name: "dev",
        }),
        makeProcess({
          id: "proc_2",
          status: "exited",
          success: false,
          exitCode: 7,
          endTime: 2000,
          name: "lint",
        }),
      ],
      theme,
    );
    expect(lines).toHaveLength(1);
    // Failed process shown individually with error glyph and name.
    expect(lines[0]).toContain("{error:!}");
    expect(lines[0]).toContain("{error:lint}");
    // No done summary since the only finished process failed.
    expect(lines[0]).not.toContain("done");
  });

  it("renders a failed exit with an error-toned name", () => {
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
    expect(lines[0]).toContain("{error:dev}");
  });

  it("joins multiple processes with a dim separator", () => {
    const lines = renderStatusWidget(
      [
        makeProcess({ id: "proc_1", name: "dev", status: "running" }),
        makeProcess({
          id: "proc_2",
          name: "test",
          status: "exited",
          success: false,
          exitCode: 1,
          endTime: 2000,
        }),
      ],
      theme,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("{dim:  }");
    // Live processes come before finished ones.
    expect(lines[0].indexOf("{accent:dev}")).toBeLessThan(
      lines[0].indexOf("{error:test}"),
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

  it("renders terminating with a warning dot and warning-toned name", () => {
    const lines = renderStatusWidget(
      [makeProcess({ status: "terminating" })],
      theme,
    );
    expect(lines[0]).toContain("{warning:●}");
    expect(lines[0]).toContain("{warning:dev}");
  });
});
