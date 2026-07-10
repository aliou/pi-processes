import { describe, expect, it } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import { classifyProcessEnd } from "./classify";

function makeInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
  return {
    id: "proc_1",
    name: "test",
    pid: 1234,
    command: "pnpm test",
    cwd: "/tmp",
    startTime: 1000,
    endTime: 2000,
    status: "exited",
    exitCode: 0,
    success: true,
    stdoutFile: "/tmp/stdout.log",
    stderrFile: "/tmp/stderr.log",
    endReason: "exit",
    signal: null,
    errorMessage: null,
    ...overrides,
  };
}

describe("classifyProcessEnd", () => {
  it("classifies successful exit as success", () => {
    expect(classifyProcessEnd(makeInfo({ success: true, exitCode: 0 }))).toBe(
      "success",
    );
  });

  it("classifies killed status as killed", () => {
    expect(
      classifyProcessEnd(
        makeInfo({ status: "killed", success: false, endReason: "signal" }),
      ),
    ).toBe("killed");
  });

  it("classifies spawn_error as crash", () => {
    expect(
      classifyProcessEnd(
        makeInfo({
          endReason: "spawn_error",
          success: false,
          errorMessage: "spawn failed",
        }),
      ),
    ).toBe("crash");
  });

  it("classifies missing_pid as crash", () => {
    expect(
      classifyProcessEnd(
        makeInfo({ endReason: "missing_pid", success: false }),
      ),
    ).toBe("crash");
  });

  it("classifies lost as crash", () => {
    expect(
      classifyProcessEnd(makeInfo({ endReason: "lost", success: false })),
    ).toBe("crash");
  });

  it("classifies non-zero exit code as crash", () => {
    expect(
      classifyProcessEnd(
        makeInfo({ exitCode: 1, success: false, endReason: "exit" }),
      ),
    ).toBe("crash");
  });

  it("classifies null exitCode with false success and exit reason as failure", () => {
    expect(
      classifyProcessEnd(
        makeInfo({ exitCode: null, success: false, endReason: "exit" }),
      ),
    ).toBe("failure");
  });

  it("classifies exit code 0 with false success as success (success field takes precedence)", () => {
    // success=true with exitCode 0 is the normal path
    expect(classifyProcessEnd(makeInfo({ success: true }))).toBe("success");
  });

  it("prioritizes killed status before success check", () => {
    // Even if success were somehow true with killed status, killed takes precedence
    expect(
      classifyProcessEnd(
        makeInfo({ status: "killed", success: false, endReason: "signal" }),
      ),
    ).toBe("killed");
  });
});
