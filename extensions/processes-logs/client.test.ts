import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type {
  RequestConfigPayload,
  RequestGetPayload,
  RequestListPayload,
} from "../../src/protocol";
import { CHANNELS } from "../../src/protocol";
import type { ProcessInfo } from "../../src/types";
import { DEFAULT_CONFIG } from "../processes/config";
import { requestConfig, requestProcess, requestProcessList } from "./client";

function makeInfo(overrides: Partial<ProcessInfo> = {}): ProcessInfo {
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

describe("requestProcessList", () => {
  it("returns the reply from the core extension", () => {
    const events = createEventBus();
    const info = makeInfo();

    events.on(CHANNELS.REQUEST_LIST, (payload: unknown) => {
      const p = payload as RequestListPayload;
      p.reply([info]);
    });

    expect(requestProcessList(events)).toEqual([info]);
  });

  it("returns an empty array when no listener replies", () => {
    const events = createEventBus();
    expect(requestProcessList(events)).toEqual([]);
  });
});

describe("requestProcess", () => {
  it("returns the matching process info", () => {
    const events = createEventBus();
    const info = makeInfo();

    events.on(CHANNELS.REQUEST_GET, (payload: unknown) => {
      const p = payload as RequestGetPayload;
      p.reply(p.id === "proc_1" ? info : null);
    });

    expect(requestProcess(events, "proc_1")).toEqual(info);
    expect(requestProcess(events, "missing")).toBeNull();
  });

  it("returns null when no listener replies", () => {
    const events = createEventBus();
    expect(requestProcess(events, "proc_1")).toBeNull();
  });
});

describe("requestConfig", () => {
  it("returns the resolved config", () => {
    const events = createEventBus();
    const config = DEFAULT_CONFIG;

    events.on(CHANNELS.REQUEST_CONFIG, (payload: unknown) => {
      const p = payload as RequestConfigPayload;
      p.reply(config);
    });

    expect(requestConfig(events)).toBe(config);
  });

  it("throws when no listener replies", () => {
    const events = createEventBus();
    expect(() => requestConfig(events)).toThrow(
      "processes core extension did not reply to config request",
    );
  });
});
