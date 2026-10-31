# Evals

Behavioral, model-backed checks for the processes extension. An eval drives a real model through a real Pi
`AgentSession` with the extension loaded, then asserts on the tool calls it made — does it poll, does it reach for
a log watch, does it background with `&` instead of the `process` tool.

Unit behavior belongs in `src/**/*.test.ts` and `extensions/**/*.test.ts`. Integration with real child processes
belongs in `tests/e2e/`. Only agent *behavior* belongs here.

Evals make real, paid model calls. They are not part of `pnpm test` and never run on push in CI.

## Ours vs vendored

Two kinds of code live in this directory, and the distinction matters when something breaks.

### Our code (committed, edit freely)

| Path | What it is |
|---|---|
| `harness.ts` | Wraps the vendored harness with the processes extension path and tool-call extraction helpers. Import this, never the vendored file directly. |
| `*.eval.ts` | The evals themselves. |
| `global-setup.ts` | Generates `agent-dir/models.json` from `.env.test` / the environment before any eval runs. |
| `vitest.config.ts` | Eval-only Vitest config: pins the agent dir, provider, and model; long timeouts; no global mocks. |
| `tsconfig.json` | Separate TS project so `pnpm typecheck` stays green when `vendor/` is absent. |
| `patches/` | Patches applied to the vendored harness after each sync. |
| `README.md` | This file. |

### Vendored and patched (gitignored, never edit in place)

| Path | What it is |
|---|---|
| `vendor/pi-evals/pi-harness.ts` | Copied from `packages/evals/src/pi-harness.ts` in `earendil-works/pi`, then patched. |
| `vendor/pi-evals/vitest-evals/` | Copied from `packages/evals/src/vitest-evals/` — artifacts, reporter, summary, harness table. |
| `vendor/pi-evals/upstream-package.json` | The upstream `package.json`, kept only as a dependency-version reference. |
| `agent-dir/` | Generated local model configuration and connection settings. Never commit this directory. |

`@earendil-works/pi-evals` is `"private": true` and not published to npm, so it cannot be installed. It is copied
in from the pi repo at a pinned tag by:

```bash
./.agents/skills/sync-pi-evals/scripts/sync-pi-evals.sh
```

CI runs that same script in the gated `evals` job. See the `sync-pi-evals` skill for ref selection and dependency
reconciliation.

Anything you change under `vendor/` is destroyed by the next sync. To change vendored behavior, edit
`patches/0001-harness-additional-resource-paths.patch` instead, or regenerate it with `diff -u` against a clean
copy.

### Why the harness is patched at all

Upstream's harness deliberately refuses to load extensions: it builds its own temp `cwd`, uses
`SettingsManager.inMemory()`, forwards `resourceLoaderOptions` only when `transformSystemPrompt` is set, and hard
asserts that zero extensions loaded. There is no external hook, so the patch adds
`additionalExtensionPaths` / `additionalSkillPaths`, always forwards `resourceLoaderOptions`, and relaxes the
guard to expect exactly the injected extensions. It also widens the environment parameter type for compatibility and emits `session_shutdown` before disposal on successful and failed runs, so injected extensions release their processes and listeners.

That guard is load-bearing: if the extension path is wrong, evals fail with `Expected the isolated eval session to
load exactly 1 extension(s), got 0` rather than silently passing with no `process` tool present.

## Running

```bash
pnpm typecheck:evals
pnpm test:evals tests/evals/harness.eval.ts
pnpm test:evals tests/evals/smoke.eval.ts
pnpm test:evals tests/evals/guidance.eval.ts
pnpm test:evals
```

First run `pnpm typecheck:evals`; it needs the vendored harness present but costs nothing. `harness.eval.ts` also makes no model calls: it checks result guards with synthetic returned details.

### Artifacts

The vendored reporter only writes artifacts when `PI_EVAL_ARTIFACT_DIR` is set. `vitest.config.ts` defaults it to
`.eval/` (gitignored) and creates the directory, so local runs produce them too. The reporter runs in the main
process, so this is set on `process.env` rather than `test.env`.

### Configuration

`vitest.config.ts` isolates evals from your normal agent directory and pins provider/model defaults. Select a local model explicitly with `PI_EVAL_PROVIDER` and `PI_EVAL_MODEL`; ambient `PI_PROVIDER` and `PI_MODEL` do not override the eval defaults.

Copy `.env.test.example` to the ignored `.env.test` and configure your local connection settings. `global-setup.ts` generates the ignored `tests/evals/agent-dir/models.json` before each run. Existing environment settings take precedence over `.env.test`.

Keep provider registration, model catalogues, credentials and experimental configuration in local untracked state, not committed eval setup. The current setup regenerates its default model configuration. The harness resolves models before loading extensions, so provider registration must be available in the local agent directory rather than supplied by an extension.

## Verifying an eval is trustworthy

A green eval is worthless if it passed for the wrong reason.

1. Every eval asserts `activeTools` contains `process`. Without it, "the agent never polled" also passes when the
   extension failed to load and there was no `process` tool at all.
2. Invert a new eval once — flip the prompt to induce the bad behavior and confirm it fails. An assertion that has
   never failed has not been tested.
3. Read the transcript. Runs write `.eval/runs.jsonl` (one record per run: test, harness, token usage, timings)
   and the native Pi session JSONL under `.eval/sessions/<hash>/session.jsonl`. These contain prompts, responses,
   and tool output. CI uploads both as the `eval-artifacts` artifact.
4. Repeat before concluding. Single runs are noisy.

Prefer deterministic assertions on tool calls over judges. Tool discipline is mechanical; reserve `createJudge` for
genuinely fuzzy questions and set `judgeThreshold: null` so a low score is an observation, not a suite failure.

Write prompts so a violation is unambiguous. "Check its output exactly once, then stop" makes a second call clearly
wrong; a vague prompt does not.
