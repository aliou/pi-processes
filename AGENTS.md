# pi-processes

Public Pi package for managing background processes. Exposes multiple Pi extensions.

## Tool and command audience

The `process` tool and all `/ps:*` commands are for **LLM use only**, not for users directly. Users can monitor and control processes via `/ps` and `/ps:logs`, but they should never be the ones starting processes -- that is the agent's job.

During UI tests that require processes to be running, either give the user a prompt to send to the agent (which will start the processes via the `process` tool), or use tmux to drive it programmatically. Never instruct the user to run shell commands manually.

## Platform support

- macOS: supported
- Linux: supported
- Windows: not supported (the manager relies on POSIX process groups)

## Stack

- TypeScript (strict mode), Node.js >=22.19.0, pnpm 10.26.1, Biome, Changesets
- The package targets Pi 0.80.3. Keep imported Pi-bundled packages in `peerDependencies` with `"*"` ranges and exact local versions in `devDependencies`: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and `typebox`.

## Scripts

- `pnpm typecheck` — TypeScript check
- `pnpm lint` — Biome check
- `pnpm format` — Biome check with write
- `pnpm gen:schema` — regenerate `schema.json` from `extensions/processes/config/types.ts`
- `pnpm check:schema` — verify `schema.json` is up to date
- `pnpm check:changesets` — validate `.changeset/*.md` frontmatter, package names, and bump types
- `pnpm test` — Unit tests
- `pnpm test:e2e` — End-to-end tests
- `pnpm changeset` — Add a changeset
- `pnpm version` — Apply changeset versions
- `pnpm release` — Publish the package
- `pnpm check:lockfile` — Verify `pnpm-lock.yaml` is up to date
- `pnpm prepare` — Husky install (git hooks)

Run `pnpm install` after package metadata changes and check Pi package resolution with `pnpm why @earendil-works/pi-tui` and `pnpm why @earendil-works/pi-ai`.

## Testing

Unit tests live next to the source as `src/**/*.test.ts` and run with `pnpm test`.

Use unit tests for behavior that can be isolated with mocks: registry state, log storage, output parsing, watch matching, event emission, throttling, kill timeout behavior, command parsing, and other pure or narrowly scoped manager internals. Unit tests should stay fast, deterministic, and Pi-independent. Mock child processes, filesystem access, timers, and process-group calls when the test is about manager behavior rather than operating-system behavior.

Regression tests for a specific bug fix live next to the source in their own file (e.g. `widget/setup.test.ts` for `widget/setup.ts`), not in a separate directory — locality keeps the guard visible to anyone editing the module. The full investigation and reproduction rationale belongs in the linked issue/PR and changeset, not the test; a one-line `// Regression: <short description> (#NNN).` header is enough. Test names should describe the behavior being guarded (`auto-closes after a short-lived process (<125ms throttle window)`), not the bug.

E2E tests live in `tests/e2e/**/*.e2e.ts` and run with `pnpm test:e2e`. They use `vitest.e2e.config.ts`, real temporary directories, real log files, and real child processes. Use e2e tests when the point is to prove integration with Node process spawning, process groups, stdin/stdout/stderr streams, real filesystem cleanup, executable scripts, shell scripts, Node scripts, or long-running watcher flows. E2E tests must remain Pi-independent and should not import extension UI code.

E2E tests use the fixtures in `tests/e2e/fixtures.ts`. Each test gets a `cwd` temporary directory that is removed with fixture cleanup. Use `addScript(name)` to copy a fixture script into that directory, and `addFile(name, content?)` to create marker/input files during a test. Write commands explicitly in tests, such as `./server.sh`, `bash ./crash-on-file.sh`, or `node ./watcher.mjs`.

Avoid fixed sleeps in both unit and e2e tests. Prefer event-driven helpers that wait for process end, watch matches, output events, or marker-driven script behavior. Use fake timers only for intentional timer behavior in unit tests.

## Structure

- `src/` - pi-agnostic process management (manager, types, protocol, utils). Zero pi imports.
- `extensions/processes/` - core extension: tool registration, settings, hooks, event bridge, request/command handlers, `/ps` overview panel, `/ps:kill`, `/ps:clear`, `/ps:settings`
- `extensions/processes/config/migrations/` - ordered settings migrations. Each migration lives in its own file prefixed with its index, such as `001-v0-9-4-to-v0-10-0-config.ts`. Migrations declare a semver `version` (the loader stamps it after a successful run); the terminal migration in `002-stamp-config-version.ts` exports `PROCESS_CONFIG_VERSION`, which must match the `--version` flag in the `gen:schema` and `check:schema` scripts.
- `extensions/processes-logs/` - `/ps:logs` command and log overlay
- `extensions/processes-dock/` - `/ps:dock`, `/ps:pin` commands, dock widget, status widget, `COMMAND_PIN` handler
- `extensions/shared/` - shared UI helpers used across all three extensions: `ui.ts` (`statusDot`, `processStatusTone`, `LineComponent`), `display-text.ts` (`sanitizeForDisplay`), `truncate.ts` (ANSI-safe `truncateToWidth`), `log-line.ts` (`renderLogLine`), `line-buffer.ts`
- `plugins/` - repo-local Biome GritQL lint plugins, registered in `biome.json`
- `skills/` - shipped package skills consumed by Pi
- `.agents/skills/` - local repo-only skills for development workflows
- `docs/` - documentation and design notes (current behavior, architecture, canonical references, future design proposals). See `docs/README.md` for the index.

## Documentation

`docs/` holds both living docs (current behavior) and future-design notes (proposed work, prefixed `future-`). When a change to lifecycle, notifications, config, or public behavior lands, update the relevant `docs/` entry (start with `docs/notifications.md` for notification/event flow) and retire the matching future-design note by folding its landed behavior into a living doc.

When adding a doc, name it for its subject (`docs/notifications.md`, not `docs/new-foo.md`) and add it to `docs/README.md`. Anchor call-stack nodes to real symbols and plain repo paths, never line numbers.

## Rendering conventions

Build TUI output with `Container` + `addChild`. Do not join strings and pass them to `Text`.

- Render functions must be pure. Do not mutate `this.children` inside `render()`.
- Use a class extending `Container` (or implementing `Component`) for reused UI pieces.
- Use inline `Container` composition for one-off render trees.

### Untrusted text

Process output, names, commands, and cwd are untrusted display text. Never interpolate them into a rendered string raw.

- Log lines: `renderLogLine` from `extensions/shared/log-line.ts`.
- Bounded labels: `truncateForDisplay` from `extensions/shared/display-text.ts`.
- Everything else: `sanitizeForDisplay`.
- Truncate with `truncateToWidth` from `extensions/shared/truncate.ts`, never the one from `@earendil-works/pi-tui`. Pi's version injects `ESC[0m` and mis-parses non-SGR escape sequences; `plugins/no-pi-tui-truncate.grit` fails the lint if it is imported.

## Builder pattern for UI helpers

UI helper functions return a `Component`; they never mutate a passed-in container.

- Name them `buildXxx(...)`, not `addXxx(container, ...)`.
- The caller adds the result: `container.addChild(buildXxx(...))`.

## Core layer boundaries

`src/` manages process state. It has no opinions about display.

- `ProcessManager` / `ProcessRegistry` return insertion order. No sorting, filtering, or formatting.
- Process IDs are opaque strings. Do not assume they are numerical or monotonically increasing.
- Display concerns (sorting, truncation, color) belong in the tool/UI layer only.

## Disk usage

Process output is stored twice on disk: once in the per-stream file (`stdout.log` / `stderr.log`) and again in `combined.log`. Each file is capped at 64 MB (`MAX_LOG_FILE_BYTES`) via truncate-and-restart, so budget ~128 MB per process for a stdout-only process and ~192 MB for one using both streams. The log directory is created lazily on first process start, so sessions that never start a process leave no temp directory behind.
