---
name: writing-pi-evals
description: Write, run, and verify behavioral evals for the processes extension using the vendored pi-evals harness. Use when adding or debugging an eval in evals/, running the eval suite, or checking whether an eval result is trustworthy.
---

# Writing pi-processes evals

Evals drive a real model through a real `AgentSession` with the processes extension loaded, then assert on the
resulting tool calls. They measure agent behaviour (does it poll? does it reach for a log watch?), not unit
correctness. Unit behaviour belongs in `src/**/*.test.ts` and `extensions/**/*.test.ts`.

Prerequisite: the vendored harness must be present at `tests/evals/vendor/pi-evals/`. If it is missing, run
`./.agents/skills/sync-pi-evals/scripts/sync-pi-evals.sh` (see the `sync-pi-evals` skill). Nothing here works
without it.

## Layout

- `tests/evals/harness.ts` — committed. Wraps the vendored `createPiCodingAgentHarness` with the processes extension
  path, plus tool-call extraction helpers. Import this, never the vendored file directly.
- `tests/evals/*.eval.ts` — committed. One file per behaviour area.
- `tests/evals/patches/` — committed. Patches applied to the vendored harness during sync.
- `tests/evals/global-setup.ts` — committed. Generates `agent-dir/models.json` from `.env.test` before any run.
- `tests/evals/README.md` — committed. Explains which files are ours and which are vendored.
- `tests/evals/vendor/` — gitignored. Produced by `sync-pi-evals`.
- `tests/evals/vitest.config.ts` — separate config; `include: ["tests/evals/**/*.eval.ts"]`, long timeouts, no parallelism, no
  global mocks (the unit `vitest.config.ts` mocks `node:fs` via memfs, which would break real process spawning).
- `tests/evals/tsconfig.json` — separate project so `pnpm typecheck` stays green when `tests/evals/vendor/` is absent.

## Running

```bash
pnpm test:evals                            # whole suite
pnpm test:evals tests/evals/smoke.eval.ts        # one file
pnpm test:evals -t "smoke"                 # one test by name
pnpm typecheck:evals                 # after sync or harness edits, costs nothing
```

No environment variables required. `tests/evals/vitest.config.ts` pins everything that decides which model runs:

- `PI_CODING_AGENT_DIR` to `tests/evals/agent-dir/`, so runs never read or spend from your real `~/.pi/agent`.
- `PI_PROVIDER` / `PI_MODEL` to `aperture` / `syn:small:text`, pinned rather than inherited so an ambient
  `PI_PROVIDER=anthropic` in your shell cannot silently redirect evals at a paid account.

Override with `PI_EVAL_PROVIDER` / `PI_EVAL_MODEL` — not `PI_PROVIDER`, which the config overwrites.

`tests/evals/agent-dir/` is generated at run time by `global-setup.ts` and is entirely gitignored: the Aperture
base URL is private. Set it with `cp .env.test.example .env.test`, or export `APERTURE_BASE_URL` (CI uses a
secret, and a real env var wins over `.env.test`). Aperture is reachable over Tailscale.

### Only built-in and models.json providers work

The harness calls `ModelRuntime.create()` with no arguments and resolves the model *before* it builds the session,
so providers that your normal setup registers through extensions do not exist yet. `Eval model not found:
<provider>/<id>` means the provider needs a `providers` entry in `tests/evals/agent-dir/models.json`, not an extension.

Run `tests/evals/smoke.eval.ts` first when you suspect the setup. It is one short round trip with thinking off and is
the cheapest way to separate "the setup is broken" from "the agent behaved badly". Keep it that way: do not split
it into multiple tests or add prompts that invite the model to explain itself.

## Writing an eval

Use `createProcessesHarness()` from `tests/evals/harness.ts`. Its `output` exposes a JSON-safe view:

- `response` — final assistant text.
- `toolCalls` — every `process` call in order, with `arguments`.
- `bashCommands` — every `bash` command string, for catching `&` / `nohup` backgrounding.
- `activeTools` — tool names registered in the session.

Assert on `result.output`. Judges and assertions receive `output`, not the live `AgentSession`.

```ts
import { expect } from "vitest";
import { describeEval } from "vitest-evals";

import { callsWithAction, createProcessesHarness } from "./harness.ts";

const harness = createProcessesHarness();

describeEval("process tool: <behaviour>", { harness }, (it) => {
  it("<expected behaviour>", async ({ run }) => {
    const result = await run("<prompt>");
    expect(result.output.activeTools).toContain("process");
    expect(callsWithAction(result.output.toolCalls, "start")).toHaveLength(1);
  });
});
```

Multi-turn scenarios pass an array of steps. Use this to seed a bad pattern before testing recovery:

```ts
const result = await run([
  { type: "prompt", content: "Start ... without a log watch." },
  { type: "prompt", content: "Check its output." },
  { type: "prompt", content: "Check its output again." },
  { type: "prompt", content: "You keep checking by hand. Fix that." },
]);
```

`{ type: "reload" }` steps re-run resource loading, needed when a prompt created or changed Pi resources on disk.

### Prefer deterministic assertions

Tool discipline is mechanical: did it call `output` twice, did it pass `notify.logMatches`, did it shell out with
`&`. Assert directly on `toolCalls` / `bashCommands`. Reserve `createJudge(...)` for genuinely fuzzy questions like
"did it explain why it backgrounded the command", and set `judgeThreshold: null` so a low score is an observation
rather than a suite failure.

### Write prompts that make violations unambiguous

A model checking output twice under a vague prompt is not misbehaviour. Say "check its output exactly once, then
stop and end your turn" so a second call is unambiguously wrong. If you cannot phrase the prompt so a violation is
clear-cut, the behaviour probably needs a judge, not an assertion.

## Verifying an eval is trustworthy

A green eval is worthless if it passed for the wrong reason. Before believing a result:

1. **Guard against trivial passes.** Every eval asserts `expect(result.output.activeTools).toContain("process")`
   and that the expected `start` call happened. Without this, "the agent never polled" also passes when the
   extension failed to load and the agent had no `process` tool at all.
2. **Confirm the extension count.** The patched harness throws if the number of loaded extensions does not match
   `additionalExtensionPaths`. An error mentioning "Expected the isolated eval session to load exactly N
   extension(s)" means the patch or the extension path is wrong, not that the agent misbehaved.
3. **Read the transcript.** Each run writes a native Pi session JSONL under `.eval/sessions/`, indexed by
   `.eval/runs.jsonl`. Open the session for a surprising pass or fail and read the actual tool calls. These files
   contain prompts, responses, and tool output.
4. **Invert the eval once.** For a new behavioural assertion, temporarily flip the prompt to induce the bad
   behaviour (e.g. "keep checking the output until it finishes") and confirm the eval fails. An assertion that has
   never failed has not been tested.
5. **Repeat before concluding.** Single runs are noisy. Re-run a few times, or use `evalHarnessTable(...)` with
   `repetitions` for comparative work, before claiming a behaviour changed.

## Comparative evals

To measure whether the shipped skill or a prompt change helps, build a baseline/candidate table with
`evalHarnessTable(...)` from the vendored `tests/evals/vendor/pi-evals/vitest-evals/harness-table.ts` and Vitest's
`describe.for(...)`. `createProcessesHarnessWithSkill()` exists as the candidate side against
`createProcessesHarness()` as baseline. Record correctness with a judge, set `judgeThreshold: null`, and read the
reporter's pass-rate lift rather than individual pass/fail.

## Cost and etiquette

Every eval run costs real tokens against a real provider. The config runs files serially with
`maxConcurrency: 1`. Do not add retries to paper over flaky behaviour — a flaky eval is a finding. Scope runs with
`-t` while iterating instead of running the whole suite.
