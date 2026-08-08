import { expect } from "vitest";
import { describeEval } from "vitest-evals";

import { createProcessesHarness } from "./harness";

const harness = createProcessesHarness("smoke");

/**
 * Cheapest possible end-to-end check of the eval setup itself.
 *
 * If this fails, the problem is the harness wiring (vendored pi-evals, model
 * credentials, extension loading) rather than agent behaviour. Run it first
 * after every `sync-pi-evals`.
 *
 * Deliberately one single-token round trip: the harness already runs with
 * thinking disabled, the prompt forbids preamble, and both assertions are
 * checked from that one response. Do not split this into two tests or add
 * prompts that invite the model to explain itself.
 */
describeEval("eval setup smoke", { harness }, (it) => {
  it("reaches the model with the processes extension loaded", async ({
    run,
  }) => {
    const result = await run("Reply with exactly: ok");

    // Model is reachable and the response round-trips.
    expect(result.output.response.trim().toLowerCase()).toContain("ok");

    // The patched harness actually injected our extension. This is read from
    // the session, so it costs nothing beyond the call already made above.
    expect(result.output.activeTools).toContain("process");
  });
});
