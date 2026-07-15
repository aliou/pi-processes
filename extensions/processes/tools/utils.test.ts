import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { ProcessInfo } from "../../../src/types";
import { buildProcessDetails } from "./utils";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

describe("buildProcessDetails", () => {
  it("shortens the home directory in the displayed cwd", () => {
    const process: ProcessInfo = {
      id: "proc_1",
      name: "dev",
      pid: 123,
      command: "pnpm dev",
      cwd: `${homedir()}/project`,
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

    expect(
      buildProcessDetails(process, theme).render(100).join("\n"),
    ).toContain("cwd: ~/project");
  });
});
