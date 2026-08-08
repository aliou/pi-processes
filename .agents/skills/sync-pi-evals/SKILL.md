---
name: sync-pi-evals
description: Vendor and refresh the unpublished pi-evals harness from earendil-works/pi into tests/evals/vendor, and keep pi-* devDependencies compatible with it. Use when asked to set up, refresh, or update the evals harness or vendored pi-evals code in pi-processes.
---

# Syncing vendored pi-evals

`@earendil-works/pi-evals` (`packages/evals` in `earendil-works/pi`) is `"private": true` and not published to npm.
Until it ships publicly, the harness source is copied into `tests/evals/vendor/pi-evals/` (gitignored) and patched.

Why not a pnpm git dependency: installing `github:earendil-works/pi#<ref>&path:packages/evals` does fetch the code,
but the harness must be patched, and `pnpm patch` on that dependency fails with
`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` — it tries to prepare the whole `pi-monorepo` root and demands an
`allowBuilds` entry for it. Revisit if pi publishes the package or upstreams extension injection.

Do not run the eval suite as part of syncing: evals make real, paid model calls. `pnpm typecheck:evals` is the free
check that a vendor drop is sound.

## Run the script

```bash
./.agents/skills/sync-pi-evals/scripts/sync-pi-evals.sh                 # pinned default ref
./.agents/skills/sync-pi-evals/scripts/sync-pi-evals.sh --ref v0.85.0   # tag, branch, or SHA
```

It clones the pi repo at the ref, copies `pi-harness.ts` and `vitest-evals/`, records the upstream `package.json`
as `upstream-package.json`, applies every patch in `tests/evals/patches/`, and writes `tests/evals/vendor/SYNC.json`
with the ref, resolved SHA, and date. Re-running is safe: `rsync --delete` restores pristine files before patching.

The script only mechanises the copy. The two decisions below are yours.

## Decision 1: which ref

Read `tests/evals/vendor/SYNC.json` first to see what is currently vendored.

Default rule: use the git tag matching the `@earendil-works/pi-coding-agent` version pinned in this repo's
`package.json` devDependencies (devDependency `0.84.1` → tag `v0.84.1`). The harness calls
`AgentSession` / `createAgentSessionServices` APIs, so it must match the coding-agent version we build against.

Exception: if the harness change you need landed on `main` after the latest tag, pin the exact SHA rather than a
branch, and check whether that commit's `packages/coding-agent` API is compatible with the version installed here.
If it is not, stop and ask the user before syncing — see decision 2.

Never sync from a floating branch. The script accepts one, but the result is not reproducible.

## Decision 2: dependency reconciliation — always ask before bumping

After syncing, compare `tests/evals/vendor/pi-evals/upstream-package.json` devDependencies against this repo's
`package.json`:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-coding-agent`
- `vitest`
- `vitest-evals` (already a devDependency here, pinned exact)

Then run `pnpm typecheck:evals`. It compiles the vendored and patched harness against this repo's installed
versions and is the real compatibility signal.

If it passes and versions match: done.

If versions differ or the typecheck fails:

1. Report the mismatch explicitly: which package, the version pinned here, the version the vendored code expects,
   and whether that version is published (`npm view @earendil-works/pi-coding-agent version`).
2. If it is published: propose bumping `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`,
   `@earendil-works/pi-tui`, and `vitest` (plus matching `peerDependencies` ranges), and ask for confirmation
   before running `pnpm add -D <pkg>@<version>`. This repo uses pnpm. Never bump silently.
3. If it is not published: say the vendored harness is ahead of what is installable, and ask whether to re-sync
   from the last tag (losing the new harness feature) or wait for the next pi release.

## The patches

`tests/evals/patches/0001-harness-additional-resource-paths.patch` makes four changes, all required:

1. adds `additionalExtensionPaths` / `additionalSkillPaths` options,
2. always forwards `resourceLoaderOptions` (upstream only does when `transformSystemPrompt` is set),
3. relaxes the zero-extension guard to expect exactly the injected extensions,
4. widens `resolveModelSelection`'s `environment` parameter to `Record<string, string | undefined>`, because
   `@types/node` 25 here makes `ProcessEnv` incompatible with upstream's inline literal type.

Upstream's harness deliberately refuses to load extensions, so without 1–3 there is no way to get the processes
extension into an eval session.

If the script reports a failed patch, upstream moved. Re-derive the change by hand against the newly vendored
`pi-harness.ts`, regenerate with `diff -u`, and commit the updated patch file. Do not skip it.

## After syncing

- `pnpm typecheck:evals` must pass. `pnpm typecheck` excludes `tests/evals` on purpose, so it stays green without a
  vendor drop.
- Verify with `git status` that nothing under `tests/evals/vendor/` is staged; it is gitignored.
- CI runs this same script in the gated `evals` job, so a working sync locally means a working sync there.

For writing, running, and verifying the evals themselves, see the `writing-pi-evals` skill and
`tests/evals/README.md`.

## Re-sync when

- `@earendil-works/pi-coding-agent` is bumped here.
- An eval needs a harness capability that only exists in a newer pi commit.
- `SYNC.json` predates a pi release this repo has adopted.
