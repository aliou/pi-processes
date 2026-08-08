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
| `agent-dir/` | Generated at run time. Holds the private Aperture base URL, so none of it is committed. |

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
guard to expect exactly the injected extensions. It also widens one `process.env` parameter type that
`@types/node` 25 rejects.

That guard is load-bearing: if the extension path is wrong, evals fail with `Expected the isolated eval session to
load exactly 1 extension(s), got 0` rather than silently passing with no `process` tool present.

## Running

```bash
pnpm test:evals                              # whole suite
pnpm test:evals tests/evals/smoke.eval.ts    # one file
pnpm test:evals -t "smoke"                   # one test by name
pnpm typecheck:evals                         # free, no model calls
```

First run `pnpm typecheck:evals`; it needs the vendored harness present but costs nothing.

### Configuration

`vitest.config.ts` pins everything that decides which model runs, so an ambient `PI_PROVIDER=anthropic` in your
shell cannot redirect evals at a paid account:

- `PI_CODING_AGENT_DIR` → `tests/evals/agent-dir/`, never your real `~/.pi/agent`.
- `PI_PROVIDER` / `PI_MODEL` → `aperture` / `syn:small:text`. Override with `PI_EVAL_PROVIDER` / `PI_EVAL_MODEL`.

The Aperture base URL is private, and `models.json` has no environment-variable interpolation, so `global-setup.ts`
generates that file at run time:

```bash
cp .env.test.example .env.test   # then fill in APERTURE_BASE_URL
```

A real `APERTURE_BASE_URL` in the environment wins over `.env.test`, which is how CI injects its secret. Aperture
is reachable over Tailscale; CI connects with `tailscale/github-action` before running.

Only built-in providers and those declared in the generated `models.json` work. The harness calls
`ModelRuntime.create()` and resolves the model *before* building the session, so providers that your normal setup
registers through extensions do not exist yet. `Eval model not found: <provider>/<id>` means it needs a `providers`
entry, not an extension.

## Verifying an eval is trustworthy

A green eval is worthless if it passed for the wrong reason.

1. Every eval asserts `activeTools` contains `process`. Without it, "the agent never polled" also passes when the
   extension failed to load and there was no `process` tool at all.
2. Invert a new eval once — flip the prompt to induce the bad behavior and confirm it fails. An assertion that has
   never failed has not been tested.
3. Read the transcript. Runs write native Pi session JSONL under `.eval/`, indexed by `runs.jsonl`.
4. Repeat before concluding. Single runs are noisy.

Prefer deterministic assertions on tool calls over judges. Tool discipline is mechanical; reserve `createJudge` for
genuinely fuzzy questions and set `judgeThreshold: null` so a low score is an observation, not a suite failure.

Write prompts so a violation is unambiguous. "Check its output exactly once, then stop" makes a second call clearly
wrong; a vague prompt does not.
