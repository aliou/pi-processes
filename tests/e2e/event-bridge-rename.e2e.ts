import { createEventBus } from "@earendil-works/pi-coding-agent";
import { expect, vi } from "vitest";

import { registerEventBridge } from "../../extensions/processes/hooks/event-bridge";
import { CHANNELS } from "../../extensions/shared/protocol";
import { ProcessManager } from "../../src/manager";
import { test } from "./fixtures";

test("broadcasts an updated change when renaming a process", async ({
  cwd,
}) => {
  using manager = new ProcessManager();
  const started = await manager.start("before", "sleep 60", cwd);
  const events = createEventBus();
  const changed = vi.fn();
  events.on(CHANNELS.CHANGED, changed);
  registerEventBridge(events, manager);

  const renamed = manager.rename(started.id, "after");

  expect(renamed?.name).toBe("after");
  expect(manager.get(started.id)).toEqual(
    expect.objectContaining({ name: "after", status: "running" }),
  );
  expect(changed).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledWith({ reason: "updated" });
});
