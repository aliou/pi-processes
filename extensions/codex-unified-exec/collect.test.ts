import { describe, expect, it } from "vitest";

import { collectOutputUntilDeadline } from "./collect";
import { HeadTailBuffer } from "./head-tail-buffer";
import { CancellationToken, Gate, Notify } from "./notify";

const setup = (maxBytes = 1024 * 1024) => {
  const buffer = new HeadTailBuffer(maxBytes);
  const outputNotify = new Notify();
  const outputClosed = new Gate();
  const cancellationToken = new CancellationToken();
  return { buffer, outputNotify, outputClosed, cancellationToken };
};

const collect = (s: ReturnType<typeof setup>, deadline: number) =>
  collectOutputUntilDeadline({ ...s, deadline });

describe("collectOutputUntilDeadline", () => {
  it("returns pre-buffered output when the process already exited and closed", async () => {
    const s = setup();
    s.buffer.pushChunk(Buffer.from("hello", "utf8"));
    s.cancellationToken.cancel();
    s.outputClosed.close();

    const collected = await collect(s, Date.now() + 5000);
    expect(collected.totalBytes()).toBe(5);
    expect(collected.toBytes().toString("utf8")).toBe("hello");
    expect(s.buffer.retainedBytes).toBe(0); // drained
  });

  it("collects output that arrives after parking, then exits and closes", async () => {
    const s = setup();
    const deadline = Date.now() + 5000;
    const p = collect(s, deadline);

    // Wait for the loop to park, then push output + signal exit/close.
    await new Promise((r) => setTimeout(r, 15));
    s.buffer.pushChunk(Buffer.from("world", "utf8"));
    s.outputNotify.notifyAll();
    // Let it drain and loop back, then end the process.
    await new Promise((r) => setTimeout(r, 15));
    s.cancellationToken.cancel();
    s.outputClosed.close();
    s.outputNotify.notifyAll();

    const collected = await p;
    expect(collected.toBytes().toString("utf8")).toBe("world");
  });

  it("times out when nothing arrives and the process does not exit", async () => {
    const s = setup();
    const start = Date.now();
    const collected = await collect(s, start + 30);
    // Broke on the deadline, not on exit/close.
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    expect(collected.totalBytes()).toBe(0);
    expect(s.cancellationToken.isCancelled).toBe(false);
    expect(s.outputClosed.isClosed).toBe(false);
  });

  it("waits at most POST_EXIT_CLOSE_WAIT_MS (50ms) after exit before close", async () => {
    const s = setup();
    const start = Date.now();
    const deadline = start + 5000;
    const p = collect(s, deadline);

    await new Promise((r) => setTimeout(r, 10));
    s.cancellationToken.cancel(); // exit signal, but stdout still open
    s.outputNotify.notifyAll();

    const collected = await p;
    const elapsed = Date.now() - start;
    // Should break around the 50ms post-exit cap, well under the 5s deadline.
    expect(elapsed).toBeLessThan(500);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(collected.totalBytes()).toBe(0);
    expect(s.outputClosed.isClosed).toBe(false);
  });

  it("breaks immediately when exit + close both fire while parked", async () => {
    const s = setup();
    const start = Date.now();
    const deadline = start + 5000;
    const p = collect(s, deadline);

    await new Promise((r) => setTimeout(r, 10));
    s.cancellationToken.cancel();
    s.outputClosed.close();
    s.outputNotify.notifyAll();

    const collected = await p;
    expect(Date.now() - start).toBeLessThan(200);
    expect(collected.totalBytes()).toBe(0);
  });
});
