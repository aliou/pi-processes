import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { LogsSubscribePayload } from "../shared/protocol";
import { CHANNELS } from "../shared/protocol";
import { connectToProcessLogs } from "./logs-client";

describe("connectToProcessLogs", () => {
  it("returns initial lines from the subscription reply", () => {
    const events = createEventBus();
    const lines = [{ type: "stdout" as const, text: "hello" }];

    events.on(CHANNELS.LOGS_SUBSCRIBE, (payload: unknown) => {
      const p = payload as LogsSubscribePayload;
      p.reply({ ok: true, initialLines: lines });
    });

    const connection = connectToProcessLogs(events, "proc_1");
    expect("ok" in connection).toBe(false);
    if ("ok" in connection) return;

    expect(connection.initialLines).toEqual(lines);
  });

  it("delivers chunks for the matching subscriber", () => {
    const events = createEventBus();
    let subscriberId = "";

    events.on(CHANNELS.LOGS_SUBSCRIBE, (payload: unknown) => {
      const p = payload as LogsSubscribePayload;
      subscriberId = p.subscriberId;
      p.reply({ ok: true, initialLines: [] });
    });

    const connection = connectToProcessLogs(events, "proc_1");
    if ("ok" in connection) return;

    const callback = vi.fn();
    connection.onChunk(callback);

    events.emit(CHANNELS.LOGS_CHUNK, {
      subscriberId,
      processId: "proc_1",
      lines: [{ type: "stderr", text: "warning" }],
    });

    expect(callback).toHaveBeenCalledWith([
      { type: "stderr", text: "warning" },
    ]);
  });

  it("ignores chunks for other subscribers or processes", () => {
    const events = createEventBus();
    let subscriberId = "";

    events.on(CHANNELS.LOGS_SUBSCRIBE, (payload: unknown) => {
      const p = payload as LogsSubscribePayload;
      subscriberId = p.subscriberId;
      p.reply({ ok: true, initialLines: [] });
    });

    const connection = connectToProcessLogs(events, "proc_1");
    if ("ok" in connection) return;

    const callback = vi.fn();
    connection.onChunk(callback);

    events.emit(CHANNELS.LOGS_CHUNK, {
      subscriberId: "someone-else",
      processId: "proc_1",
      lines: [{ type: "stdout", text: "nope" }],
    });
    events.emit(CHANNELS.LOGS_CHUNK, {
      subscriberId,
      processId: "proc_2",
      lines: [{ type: "stdout", text: "nope" }],
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("unsubscribes and stops chunk delivery", () => {
    const events = createEventBus();
    let subscriberId = "";
    const unsubscribed = vi.fn();

    events.on(CHANNELS.LOGS_SUBSCRIBE, (payload: unknown) => {
      const p = payload as LogsSubscribePayload;
      subscriberId = p.subscriberId;
      p.reply({ ok: true, initialLines: [] });
    });
    events.on(CHANNELS.LOGS_UNSUBSCRIBE, unsubscribed);

    const connection = connectToProcessLogs(events, "proc_1");
    if ("ok" in connection) return;

    connection.unsubscribe();
    expect(unsubscribed).toHaveBeenCalled();

    const callback = vi.fn();
    connection.onChunk(callback);
    events.emit(CHANNELS.LOGS_CHUNK, {
      subscriberId,
      processId: "proc_1",
      lines: [{ type: "stdout", text: "after" }],
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("returns an error when the core extension does not reply", () => {
    const events = createEventBus();
    const result = connectToProcessLogs(events, "proc_1");
    expect("ok" in result && result.ok === false).toBe(true);
  });

  it("returns an error when the core extension reports one", () => {
    const events = createEventBus();
    events.on(CHANNELS.LOGS_SUBSCRIBE, (payload: unknown) => {
      const p = payload as LogsSubscribePayload;
      p.reply({ ok: false, error: "process gone" });
    });

    const result = connectToProcessLogs(events, "proc_1");
    expect("ok" in result && result.ok === false).toBe(true);
    if ("ok" in result && result.ok === false) {
      expect(result.error).toBe("process gone");
    }
  });
});
