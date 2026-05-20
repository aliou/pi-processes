# pi-processes

Public Pi package for managing background processes. Exposes multiple Pi extensions.

## Tool and command audience

The `process` tool and all `/ps:*` commands are for **LLM use only**, not for users directly. Users can monitor processes via `/ps:logs` and kill them via `/ps:list`, but they should never be the ones starting processes -- that is the agent's job.

During UI tests that require processes to be running, either give the user a prompt to send to the agent (which will start the processes via the `process` tool), or use tmux to drive it programmatically. Never instruct the user to run shell commands manually.

## Stack

- TypeScript (strict mode), pnpm 10.26.1, Biome, Changesets

## Scripts

- `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`, `pnpm test:e2e`, `pnpm changeset`

## Testing

Unit tests live next to the source as `src/**/*.test.ts` and run with `pnpm test`.

Use unit tests for behavior that can be isolated with mocks: registry state, log storage, output parsing, watch matching, event emission, throttling, kill timeout behavior, command parsing, and other pure or narrowly scoped manager internals. Unit tests should stay fast, deterministic, and Pi-independent. Mock child processes, filesystem access, timers, and process-group calls when the test is about manager behavior rather than operating-system behavior.

E2E tests live in `tests/e2e/**/*.e2e.ts` and run with `pnpm test:e2e`. They use `vitest.e2e.config.ts`, real temporary directories, real log files, and real child processes. Use e2e tests when the point is to prove integration with Node process spawning, process groups, stdin/stdout/stderr streams, real filesystem cleanup, executable scripts, shell scripts, Node scripts, or long-running watcher flows. E2E tests must remain Pi-independent and should not import extension UI code.

E2E tests use the fixtures in `tests/e2e/fixtures.ts`. Each test gets a `cwd` temporary directory that is removed with fixture cleanup. Use `addScript(name)` to copy a fixture script into that directory, and `addFile(name, content?)` to create marker/input files during a test. Write commands explicitly in tests, such as `./server.sh`, `bash ./crash-on-file.sh`, or `node ./watcher.mjs`.

Avoid fixed sleeps in both unit and e2e tests. Prefer event-driven helpers that wait for process end, watch matches, output events, or marker-driven script behavior. Use fake timers only for intentional timer behavior in unit tests.

## Structure

- `src/` - pi-agnostic process management (manager, types, protocol, utils). Zero pi imports.
- `extensions/processes/` - core extension: tool registration, settings, hooks, event bridge, request/command handlers
- `extensions/processes-list/` - `/ps`, `/ps:kill`, `/ps:clear` commands and TUI components
- `extensions/processes-logs/` - `/ps:logs` command and log overlay
- `extensions/processes-dock/` - `/ps:dock`, `/ps:pin` commands, dock widget, status widget

See `PLAN.md` for the full architecture and implementation plan.
