import { describe, expect, it } from "vitest";

import type { ProcessInfo } from "../../src/types";
import {
  formatProcessSelectionDescription,
  LineComponent,
  LinesComponent,
  RuleComponent,
  statusColor,
  statusDot,
} from "./ui";

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

// `theme.fg(color, text)` -> `{color:text}` makes assertions trivial.
const theme = {
  fg: (color: string, text: string) => `{${color}:${text}}`,
  bg: (_color: string, text: string) => text,
};

describe("LineComponent", () => {
  it("renders a single line from the callback", () => {
    const component = new LineComponent((width) => `x:${width}`);
    expect(component.render(10)).toEqual(["x:10"]);
    expect(component.invalidate()).toBeUndefined();
  });
});

describe("LinesComponent", () => {
  it("renders multiple lines from the callback", () => {
    const component = new LinesComponent((width) => [
      `a:${width}`,
      `b:${width}`,
    ]);
    expect(component.render(5)).toEqual(["a:5", "b:5"]);
  });
});

describe("RuleComponent", () => {
  it("renders a dim rule sized to width", () => {
    const component = new RuleComponent(theme as never);
    expect(component.render(3)).toEqual(["{dim:───}"]);
  });

  it("clamps to non-negative width", () => {
    const component = new RuleComponent(theme as never);
    expect(component.render(0)).toEqual(["{dim:}"]);
  });
});

describe("statusColor", () => {
  it("returns accent for running", () => {
    expect(statusColor(makeProcess({ status: "running" }))).toBe("accent");
  });

  it("returns warning for terminating", () => {
    expect(statusColor(makeProcess({ status: "terminating" }))).toBe("warning");
  });

  it("returns error for failed non-killed processes", () => {
    expect(
      statusColor(
        makeProcess({ status: "exited", success: false, exitCode: 1 }),
      ),
    ).toBe("error");
    expect(
      statusColor(makeProcess({ status: "terminate_timeout", success: false })),
    ).toBe("error");
  });

  it("returns success for a clean exit", () => {
    expect(
      statusColor(
        makeProcess({ status: "exited", success: true, exitCode: 0 }),
      ),
    ).toBe("success");
  });

  it("returns dim for killed", () => {
    expect(statusColor(makeProcess({ status: "killed", success: false }))).toBe(
      "dim",
    );
  });
});

describe("statusDot", () => {
  it("uses error '!' for failed non-killed processes", () => {
    expect(
      statusDot(
        makeProcess({ status: "exited", success: false, exitCode: 1 }),
        false,
        theme as never,
      ),
    ).toBe("{error:!}");
  });

  it("uses accent dot for an active running process", () => {
    expect(
      statusDot(makeProcess({ status: "running" }), true, theme as never),
    ).toBe("{accent:●}");
  });

  it("uses dim circle for an inactive running process", () => {
    expect(
      statusDot(makeProcess({ status: "running" }), false, theme as never),
    ).toBe("{dim:○}");
  });

  it("uses warning dot for terminating", () => {
    expect(
      statusDot(makeProcess({ status: "terminating" }), true, theme as never),
    ).toBe("{warning:●}");
  });

  it("uses success check for a clean exit", () => {
    expect(
      statusDot(
        makeProcess({ status: "exited", success: true, exitCode: 0 }),
        false,
        theme as never,
      ),
    ).toBe("{success:✓}");
  });

  it("uses dim square for killed processes (not '!')", () => {
    expect(
      statusDot(
        makeProcess({ status: "killed", success: false }),
        false,
        theme as never,
      ),
    ).toBe("{dim:■}");
  });
});

describe("statusColor and statusDot agree", () => {
  const states: Array<{
    status: ProcessInfo["status"];
    success: boolean | null;
  }> = [
    { status: "running", success: null },
    { status: "running", success: true },
    { status: "terminating", success: null },
    { status: "exited", success: true },
    { status: "exited", success: false },
    { status: "killed", success: false },
    { status: "terminate_timeout", success: false },
  ];

  for (const { status, success } of states) {
    it(`${status}/${success} uses the same color from both`, () => {
      const process = makeProcess({ status, success });
      const dotColor = statusDot(process, true, theme as never).match(
        /^\{(\w+):/,
      )?.[1];
      const color = statusColor(process);
      expect(dotColor).toBe(color);
    });
  }
});

describe("formatProcessSelectionDescription", () => {
  it("formats status and command with an em dash", () => {
    expect(formatProcessSelectionDescription(makeProcess())).toBe(
      "running — pnpm dev",
    );
  });

  it("appends a suffix when provided", () => {
    expect(formatProcessSelectionDescription(makeProcess(), " — pinned")).toBe(
      "running — pnpm dev — pinned",
    );
  });

  it("omits the suffix when empty", () => {
    expect(formatProcessSelectionDescription(makeProcess(), "")).toBe(
      "running — pnpm dev",
    );
  });
});
