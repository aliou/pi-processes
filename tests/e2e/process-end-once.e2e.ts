import { expect } from "vitest";
import { getManager } from "../../src/get-manager";
import { test } from "./fixtures";
import { collectEvents, waitForEnd } from "./utils";

/**
 * A process that exits on its own must emit exactly one `process_ended`.
 * A duplicate emit reaches the notification service twice and the agent
 * receives the same lifecycle notification twice.
 */
test("emits process_ended once for a process that exits on its own", async ({
  cwd,
}) => {
  using manager = getManager();
  const events = collectEvents(manager);

  const info = manager.start("short-lived", "sleep 0.2; echo done", cwd);

  await waitForEnd(manager, info.id);
  // The liveness tick runs every 5s; give it a chance to re-classify a
  // record that the close handler already finalized.
  await new Promise((resolve) => setTimeout(resolve, 6000));

  const ended = events.filter(
    (event) => event.type === "process_ended" && event.info.id === info.id,
  );

  expect(ended).toHaveLength(1);
}, 15000);
