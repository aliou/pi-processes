import { createMock, type PartialFuncReturn } from "@golevelup/ts-vitest";
import { assert, describe, expect, it } from "vitest";
import type { ManagedProcessRecord } from "./internal-types";
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
  stdin: null,
  stdinClosed: false,
  lastSignalSent: null,
  stdoutPendingLine: "",
  stderrPendingLine: "",
  appendedLines: [],
} satisfies PartialFuncReturn<ManagedProcessRecord>;

describe("ProcessRegistry", () => {
  it("generates random process IDs", () => {
    using registry = new ProcessRegistry();
    const first = registry.nextId();
    const second = registry.nextId();
    const third = registry.nextId();

    expect(first).toMatch(/^proc_[0-9a-f]{4}$/);
    expect(second).toMatch(/^proc_[0-9a-f]{4}$/);
    expect(third).toMatch(/^proc_[0-9a-f]{4}$/);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("add and getRecord", () => {
    using registry = new ProcessRegistry();
    const managed = createMock<ManagedProcessRecord>({
      ...managedDefaults,
      id: "proc_1",
      appendedLines: [],
    });
    registry.add(managed);

    expect(registry.getRecord("proc_1")).toBe(managed);
    expect(registry.getRecord("nonexistent")).toBeUndefined();
  });

  it("getPublicInfo returns ProcessInfo", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_1",
        name: "test",
        status: "running",
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
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_1",
        appendedLines: [],
      }),
    );
    expect(registry.has("proc_1")).toBe(true);

    expect(registry.delete("proc_1")).toBe(true);
    expect(registry.has("proc_1")).toBe(false);
    expect(registry.delete("proc_1")).toBe(false);
  });

  it("list returns processes in insertion order", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_1",
        name: "oldest",
        startTime: 100,
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_2",
        name: "newest",
        startTime: 300,
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_3",
        name: "middle",
        startTime: 200,
        appendedLines: [],
      }),
    );

    expect(registry.list().map((p) => p.name)).toEqual([
      "oldest",
      "newest",
      "middle",
    ]);
  });

  it("keeps insertion order when start times match", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_alpha",
        name: "first",
        startTime: 100,
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_beta",
        name: "second",
        startTime: 100,
        appendedLines: [],
      }),
    );

    expect(registry.list().map((p) => p.name)).toEqual(["first", "second"]);
  });

  it("has checks for existence", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_1",
        appendedLines: [],
      }),
    );

    expect(registry.has("proc_1")).toBe(true);
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("hasAliveishProcesses returns true when live processes exist", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_1",
        status: "running",
        appendedLines: [],
      }),
    );

    expect(registry.hasAliveishProcesses()).toBe(true);
  });

  it("hasAliveishProcesses returns false when all are dead", () => {
    using registry = new ProcessRegistry();
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_1",
        status: "exited",
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_2",
        status: "killed",
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
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_1",
        status: "running",
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_2",
        status: "exited",
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_3",
        status: "terminating",
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
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_1",
        appendedLines: [],
      }),
    );
    registry.add(
      createMock<ManagedProcessRecord>({
        ...managedDefaults,
        id: "proc_2",
        appendedLines: [],
      }),
    );

    expect([...registry.values()].length).toBe(2);
    expect([...registry.entries()].length).toBe(2);
  });
});
