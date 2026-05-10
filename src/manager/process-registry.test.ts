import { createMock, type PartialFuncReturn } from "@golevelup/ts-vitest";
import { assert, describe, expect, it } from "vitest";
import type { ManagedProcess } from "./internal-types";
import { ProcessRegistry } from "./process-registry";

const managedDefaults = {
  id: "proc_1",
  name: "test",
  pid: 1234,
  command: "echo hi",
  cwd: "/tmp",
  startTime: 0,
  endTime: null,
  status: "running",
  exitCode: null,
  success: null,
  stdoutFile: "/tmp/stdout.log",
  stderrFile: "/tmp/stderr.log",
  combinedFile: "/tmp/combined.log",
  alertOnSuccess: false,
  alertOnFailure: true,
  alertOnKill: false,
  stdin: null,
  stdinClosed: false,
  lastSignalSent: null,
  stdoutPendingLine: "",
  stderrPendingLine: "",
  watches: [],
  appendedLines: [],
} satisfies PartialFuncReturn<ManagedProcess>;

describe("ProcessRegistry", () => {
  it("generates sequential IDs", () => {
    using registry = new ProcessRegistry();
    expect(registry.nextId()).toBe("proc_1");
    expect(registry.nextId()).toBe("proc_2");
    expect(registry.nextId()).toBe("proc_3");
  });

  it("add and getRecord", () => {
    using registry = new ProcessRegistry();
    const managed = createMock<ManagedProcess>({
      ...managedDefaults,
      id: "proc_1",
      watches: [],
      appendedLines: [],
    });
    registry.add(managed);

    expect(registry.getRecord("proc_1")).toBe(managed);
    expect(registry.getRecord("nonexistent")).toBeUndefined();
  });

  it("getPublicInfo returns ProcessInfo", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_1",
        name: "test",
        status: "running",
        watches: [],
        appendedLines: [],
      }),
    );

    const info = registry.getPublicInfo("proc_1");
    assert(info, "info should exist");
    expect(info).toEqual(
      expect.objectContaining({
        id: "proc_1",
        name: "test",
        status: "running",
      }),
    );
  });

  it("getPublicInfo returns null for unknown id", () => {
    using registry = new ProcessRegistry();
    expect(registry.getPublicInfo("nonexistent")).toBeNull();
  });

  it("delete removes a process", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_1",
        watches: [],
        appendedLines: [],
      }),
    );
    expect(registry.has("proc_1")).toBe(true);

    expect(registry.delete("proc_1")).toBe(true);
    expect(registry.has("proc_1")).toBe(false);
    expect(registry.delete("proc_1")).toBe(false);
  });

  it("list returns processes in reverse insertion order", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_1",
        name: "first",
        watches: [],
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_2",
        name: "second",
        watches: [],
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_3",
        name: "third",
        watches: [],
        appendedLines: [],
      }),
    );

    expect(registry.list().map((p) => p.name)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("has checks for existence", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_1",
        watches: [],
        appendedLines: [],
      }),
    );

    expect(registry.has("proc_1")).toBe(true);
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("hasAliveishProcesses returns true when live processes exist", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_1",
        status: "running",
        watches: [],
        appendedLines: [],
      }),
    );

    expect(registry.hasAliveishProcesses()).toBe(true);
  });

  it("hasAliveishProcesses returns false when all are dead", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_1",
        status: "exited",
        watches: [],
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_2",
        status: "killed",
        watches: [],
        appendedLines: [],
      }),
    );

    expect(registry.hasAliveishProcesses()).toBe(false);
  });

  it("hasAliveishProcesses returns false when empty", () => {
    using registry = new ProcessRegistry();
    expect(registry.hasAliveishProcesses()).toBe(false);
  });

  it("forEachAlive iterates only live processes", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_1",
        status: "running",
        watches: [],
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_2",
        status: "exited",
        watches: [],
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_3",
        status: "terminating",
        watches: [],
        appendedLines: [],
      }),
    );

    const alive: string[] = [];
    registry.forEachAlive((id) => alive.push(id));

    expect(alive).toEqual(["proc_1", "proc_3"]);
  });

  it("values and entries iterate all processes", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_1",
        watches: [],
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcess>({
        ...managedDefaults,
        id: "proc_2",
        watches: [],
        appendedLines: [],
      }),
    );

    expect([...registry.values()].length).toBe(2);
    expect([...registry.entries()].length).toBe(2);
  });
});
