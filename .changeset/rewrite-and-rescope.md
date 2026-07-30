---
"@aliou/pi-processes": minor
---

Rewrite `@aliou/pi-processes` into a pi-agnostic core plus three focused Pi extensions, each owning a self-contained UI.

## One package, three extensions

- `extensions/processes` — the core: the `process` tool, settings, notifications, and the `/ps` overview panel, `/ps:kill`, `/ps:clear`, `/ps:settings`.
- `extensions/processes-logs` — the `/ps:logs` log overlay with per-process tabs, stream filtering, follow, and search.
- `extensions/processes-dock` — the dock UI: `/ps:dock`, `/ps:pin`, the dock widget, and the status widget.
- `extensions/shared` — shared UI primitives (`statusDot`, `processStatusTone`, `LineComponent`) so all three extensions render status the same way.
- `src/` — the pi-agnostic process manager. No UI, no Pi imports.

## Harmonized UI

- One status-dot glyph system across the `/ps` panel, the `/ps:logs` overlay tabs, and the dock. Every surface shows the same running / terminating / killed / success / failure states.
- The panel, overlay, and dock read from the same shared helpers, so truncation, color, and status tone never drift between surfaces.
- `/ps` Enter pins to the dock (pin/unpin toggle) instead of focusing.
- The status widget below the editor shares the same dot system and reflows on terminal resize with `+N more` overflow.

## Better log watches

- Watches are manageable at runtime via the new `process update` action: add, replace, remove, or clear watches on a running process without restarting it.
- `start` and `list` output show active watches, and the `/ps:logs` overlay highlights matches.
- Stale log-match notifications are suppressed after a process ends or is cleared — watches are unregistered on `process_ended`, so belated output events for a cleared id short-circuit instead of flooding the conversation. Closes #54.
- Empty match patterns (literal and regex) are rejected at `start`.

## Process tool

Seven actions: `start`, `list`, `output`, `update`, `write`, `stop`, `clear`.

- `start` restores the `cwd` parameter.
- `output` filters by stream (stdout/stderr/both) and matches patterns.
- `write` sends stdin and optionally closes it; no-op calls are rejected.
- `clear` removes finished process entries.

## `/ps:logs` overlay

- Per-process tabs (`tab`), stream cycling (`s`), follow toggle (`f`), search (`/`), match navigation (`n`/`N`), jump-to-bottom (`G`), close (`q`).
- `LogFileViewer` is cached per process across tab switches.
- Tab labels share the panel's status system, so they match the overview rows.

## Dock and status widget

- `/ps:dock` (`expand`/`collapse`/`close`) and `/ps:pin`. Dock height is measured in log rows.
- The dock auto-unpins a killed focused process via `processes-changed`, so `/ps:kill` never has to touch the dock.
- Status widget (`widget.showStatusWidget`, off by default) renders a compact line of status dots under the editor, reflowing on resize.

## Settings and migration

- `/ps:settings` covers process-list, output, dock, follow, status-widget, and interception options, persisted across sessions.
- Imports the legacy `process.json` on first run and migrates v0.9.4 settings forward to v0.10.0, preserving `widget.showStatusWidget`.
- Stamps migrated `processes.json` files with `version: "0.10.0"`, so future migrations can key off an explicit config version instead of inferring from shape.

## Notifications

- Configurable events (`onSuccess`/`onFailure`/`onKilled`) with attention levels (`turn`/`context`/`ignore`). Defaults: `onKilled` = `context`, `blockBackgroundCommands` = `false`.
- Log-watch alerts fan out and are highlighted in the overlay; the dead `timeout` kind is removed.

## Intentional changes

- Log watches match literally by default with one-shot `repeat: false` defaults.
- Process IDs are opaque; sorting, truncation, and color are UI concerns only.
- Managed processes keep running in detached process groups when pi is suspended (`Ctrl+Z`); log capture continues and match notifications deliver once pi is foregrounded.

## Polish and runtime fixes

- Rate-limit delivered log-match notifications to 20 per minute across all processes, summarize suppressed matches, and cool down repeated matchers to 15 seconds.
- Share one `statusColor` / `statusDot` mapping across panel, overlay, dock, and widget; exited-success uses `✓`, and the widget collapses finished-success processes into a `✓ N done` summary.
- Clamp dock sidebar width to the longest active process name; truncate tab labels instead of padding.
- Drop the dock bottom border and fix a line-overflow crash on narrow terminals.
- Re-read dock widget config on each render so `/ps:settings` changes apply immediately.
- Reap old finished records from the manager.
- Preserve leading empty lines in tail-style log views.

## Tooling

- Targets Pi 0.80.3. 508 unit tests and 6 e2e tests pass; typecheck and lint clean. Tests are excluded from published files.
