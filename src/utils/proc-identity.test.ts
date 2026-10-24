import { vol } from "memfs";
import { describe, expect, it } from "vitest";

import {
  isPidAlive,
  procfsIdentity,
  readBootId,
  readProcessStartTime,
  startTimeFromStat,
} from "./proc-identity";

function statLine(pid: number, comm: string, starttime: string): string {
  const head = [
    String(pid),
    comm,
    "S",
    "1",
    String(pid),
    String(pid),
    "0",
    "0",
  ];
  const filler = Array.from({ length: 13 }, (_, i) => String(i));
  return `${head.join(" ")} ${filler.join(" ")} ${starttime} 0 0 0 0`;
}

describe("startTimeFromStat", () => {
  it("extracts field 22 for a plain comm", () => {
    expect(startTimeFromStat(statLine(123, "(bash)", "9999"))).toBe("9999");
  });

  it("parses a comm containing spaces and parentheses", () => {
    expect(startTimeFromStat(statLine(123, "(pi (child) proc)", "4242"))).toBe(
      "4242",
    );
  });

  it("returns null for stat without a comm section", () => {
    expect(startTimeFromStat("123")).toBeNull();
  });

  it("returns null when starttime is missing or non-numeric", () => {
    expect(startTimeFromStat(statLine(1, "(x)", "0").slice(0, 30))).toBeNull();
    expect(startTimeFromStat(statLine(1, "(x)", "not-a-number"))).toBeNull();
  });
});

describe("readBootId", () => {
  it("reads the trimmed boot id from procfs", () => {
    vol.mkdirSync("/proc/sys/kernel/random", { recursive: true });
    vol.writeFileSync("/proc/sys/kernel/random/boot_id", "abc-123\n");

    expect(readBootId()).toBe("abc-123");
  });

  it("returns null when the file is missing", () => {
    expect(readBootId()).toBeNull();
  });

  it("returns null for an empty file", () => {
    vol.mkdirSync("/proc/sys/kernel/random", { recursive: true });
    vol.writeFileSync("/proc/sys/kernel/random/boot_id", "\n");

    expect(readBootId()).toBeNull();
  });
});

describe("readProcessStartTime", () => {
  it("reads the starttime of a pid present in procfs", () => {
    vol.mkdirSync("/proc/42", { recursive: true });
    vol.writeFileSync("/proc/42/stat", statLine(42, "(sleep)", "777"));

    expect(readProcessStartTime(42)).toBe("777");
  });

  it("returns null for a missing pid", () => {
    expect(readProcessStartTime(999)).toBeNull();
  });

  it("returns null for invalid pids", () => {
    expect(readProcessStartTime(-1)).toBeNull();
    expect(readProcessStartTime(0)).toBeNull();
    expect(readProcessStartTime(1.5)).toBeNull();
  });
});

describe("isPidAlive", () => {
  it("reports the current process as alive", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for invalid pids", () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
  });
});

describe("procfsIdentity", () => {
  it("exposes the standalone readers", () => {
    expect(procfsIdentity.bootId).toBe(readBootId);
    expect(procfsIdentity.processStartTime).toBe(readProcessStartTime);
  });
});
