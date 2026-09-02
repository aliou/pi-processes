import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ManagerEvent, ProcessInfo } from "../constants";
import type { ProcessManager } from "../manager";
import { setupProcessEndHook } from "./process-end";

interface SentMessage {
  // biome-ignore lint/suspicious/noExplicitAny: test capture
  message: any;
  // biome-ignore lint/suspicious/noExplicitAny: test capture
  options: any;
}

function makeHarness() {
  const listeners: Array<(e: ManagerEvent) => void> = [];
  const manager = {
    onEvent: (l: (e: ManagerEvent) => void) => {
      listeners.push(l);
      return () => {};
    },
  } as unknown as ProcessManager;

  const sent: SentMessage[] = [];
  const pi = {
    sendMessage: (message: unknown, options: unknown) => {
      sent.push({ message, options });
    },
  } as unknown as ExtensionAPI;

  setupProcessEndHook(pi, manager);

  const emit = (e: ManagerEvent) => {
    for (const l of listeners) l(e);
  };
  return { emit, sent };
}

function ended(overrides: Partial<ProcessInfo>): ManagerEvent {
  const info: ProcessInfo = {
    id: "proc_1",
    name: "build",
    pid: 4242,
    command: "make",
    cwd: "/tmp",
    startTime: 1_000,
    endTime: 61_000,
    status: "exited",
    exitCode: 0,
    success: true,
    stdoutFile: "/tmp/proc_1-stdout.log",
    stderrFile: "/tmp/proc_1-stderr.log",
    alertOnSuccess: false,
    alertOnFailure: true,
    alertOnKill: false,
    ...overrides,
  };
  return { type: "process_ended", info };
}

describe("process-end hook", () => {
  it("delivers lifecycle completion as steer so it lands mid-turn", () => {
    const { emit, sent } = makeHarness();
    emit(ended({ alertOnSuccess: true }));

    expect(sent).toHaveLength(1);
    expect(sent[0].options.deliverAs).toBe("steer");
    expect(sent[0].options.triggerTurn).toBe(true);
    expect(sent[0].message.details.kind).toBe("lifecycle");
    expect(sent[0].message.content).toContain("completed successfully");
  });

  it("records a success without a turn when alertOnSuccess is off", () => {
    const { emit, sent } = makeHarness();
    emit(ended({ alertOnSuccess: false }));

    expect(sent[0].options).toEqual({ triggerTurn: false, deliverAs: "steer" });
  });

  it("wakes on failure by default", () => {
    const { emit, sent } = makeHarness();
    emit(ended({ success: false, exitCode: 2 }));

    expect(sent[0].options.triggerTurn).toBe(true);
    expect(sent[0].message.content).toContain("exit code 2");
  });

  it("wakes on an external kill only when asked", () => {
    const { emit, sent } = makeHarness();
    emit(ended({ status: "killed", success: false, exitCode: null }));
    emit(
      ended({
        status: "killed",
        success: false,
        exitCode: null,
        alertOnKill: true,
      }),
    );

    expect(sent[0].options.triggerTurn).toBe(false);
    expect(sent[1].options.triggerTurn).toBe(true);
  });
});
