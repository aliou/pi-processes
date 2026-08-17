---
name: pi-processes-testing
description: Test workflows for the pi-processes extension. Use when validating /ps UI/UX changes, preparing reproducible test prompts, or running manual QA with test scripts while ensuring process start is done by the LLM (not the user).
---

# pi-processes-testing

## Rules

- Treat process start as LLM-only.
- Do not ask the user to run shell commands to start background processes.
- For UI tests, either:
  - provide a prompt the user sends to the agent, or
  - run automation via tmux.

## Automated tests

Unit and e2e tests cover behavior without needing a running Pi session.

- `pnpm test` runs unit tests (`src/**/*.test.ts`, `extensions/**/*.test.ts`). They mock child processes, the filesystem, timers, and Pi internals.
- `pnpm test:e2e` runs end-to-end tests (`tests/e2e/**/*.e2e.ts`) against real child processes, real temp directories, and real log files.

### E2E fixtures

E2E tests use `tests/e2e/fixtures.ts`. Each test gets a `cwd` temp directory that is removed on cleanup. Use the injected helpers:

- `addScript(name)` copies a fixture script from `tests/e2e/scripts/` into the test's `cwd` and makes it executable.
- `addFile(name, content?)` creates a marker or input file in the test's `cwd`.

Write commands explicitly in tests, such as `./server.sh`, `bash ./crash-on-file.sh`, or `node ./watcher.mjs`.

### Fixture scripts

Available scripts under `tests/e2e/scripts/`:

| Script | Behavior | Tests |
|--------|----------|-------|
| `continuous-output.sh` | Infinite stdout every 0.5s | Background process, dock logs, output action |
| `combo-output.sh` | Mixed stdout/stderr | Stream filtering, output action |
| `crash-on-file.sh` | Waits for a marker file, then exits non-zero | Crash handling, exit detection |
| `error-log.sh` | Interleaved info/error lines | stderr filtering, log-match alerts |
| `exited-task.sh` | Finite, exits 0 | Completion, alert-on-success |
| `delayed-output.sh` | Waits before emitting | Readiness timing |
| `emit-output.sh` | Emits a fixed set of lines | Output pagination |
| `http-server.sh` | Minimal HTTP listener | Server lifecycle |
| `mixed-output.sh` | Alternating streams | Stream selection |
| `numbered-lines.sh` | Numbered lines | Scroll position, search |
| `verbose-output.sh` | Large output volume | Truncation, tail behavior |
| `wait-for-file.sh` | Blocks on a marker file | Synchronization |
| `stateful-test-watcher.mjs` | Node script with state transitions | Watch mutations, update action |

## Manual QA

When a feature needs a human in the loop (visual layout, keybinding feel, widget placement), drive it through a prompt the user sends to the agent, or via tmux. Never ask the user to start processes in a shell.

### /ps panel

- `/ps` opens the panel
- `j/k` or arrow keys move selection
- `J/K` scroll the preview
- `g/G` jump the preview to top/bottom
- `enter` pins the selected process to the dock (or unpins if already pinned)
- `x` kills the selected process
- `c` clears finished entries
- `s` cycles sort (status, started, name)
- `f` cycles filter (all, running, finished)
- `/` opens a name quick filter; `enter` applies, `esc` clears
- `?` opens the keybinds overlay (`?`, `esc`, `enter`, `q`, `ctrl+c` close it)
- `q` or `esc` closes

### /ps:logs overlay

- `/ps:logs` opens the log overlay
- `tab` / `shift+tab` switch process tabs (viewer state is cached per process)
- `g/G` jump to top or bottom
- `j/k` or arrow keys scroll
- `pgup/pgdn` scroll by a full viewport
- `ctrl+u`/`ctrl+d` scroll by half a viewport
- `s` switches between combined, stdout, and stderr
- `f` toggles follow mode
- `w` toggles soft wrap
- `/` enters search, `n/N` cycles matches, `esc` clears search
- `?` opens the keybinds overlay (`?`, `esc`, `enter`, `q`, `ctrl+c` close it)
- `q` or `esc` closes

### Footer hints and the keybinds overlay

- Single-letter shortcuts whose key letter occurs in their word render as the
  word with the key letter highlighted (accent + bold): `wrap`, `follow`,
  `clear`, `sort`, `filter`, `kill`.
- Hints whose key is not in the word keep the classic `<key> <word>` display
  (`q close`, `/ search`, `j/k scroll`).
- When the hint list does not fit the footer width, a leading `? more`
  affordance appears and remaining hints are dropped from the right.
- `?` opens a stacked keybinds panel (herdr-style groups: scrolling, view,
  tabs, general — plus a search group while a search is active).

### Dock and pin

- `/ps:dock expand|collapse|close` controls dock visibility
- `/ps:pin [id|name]` focuses the dock on one process (picker with no args)

### Kill and clear

- `/ps:kill [id|name]` stops a running process (picker with no args)
- `/ps:clear` removes finished entries and frees their log storage

### Settings

- `/ps:settings` opens the settings list, including the status widget toggle

## Reporting format

When reporting test results:

- Test file or prompt used
- Pass/fail per checklist item
- Exact reproduction steps for failures
- Expected vs actual behavior
