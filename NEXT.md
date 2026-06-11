# pi-processes: Next Steps

## 1. `update` tool action (core extension) -- DONE

Implemented in `33df3b0`.

- Rename a process (`name` field)
- Add, remove, replace, or clear log watches on a running process
- Rejects updates on non-running processes
- Revision/generation mechanism in notification registry for matcher sync
- Notification service preserves fired state on same-generation updates
- Separate `WatchUpdateItemParams` schema (supports both `index` and `pattern` for remove)
- `UpdateDetails` returns `ok`/`error` for TUI error rendering
- Expanded render shows only changes (no full process info block)
- 43 unit tests across update action, registry watch methods, and formatting
- 10 test scenarios in `tests/scenarios/11-update/`

**Addresses:** issue #26

## 2. processes-logs extension

**Commands:** `/ps:logs` + `/ps` (alias)

**Scope:**
- Log overlay with tab bar for process selection
- Live streaming via log subscription protocol (`CHANNELS.LOGS_SUBSCRIBE`/`LOGS_CHUNK`/`LOGS_UNSUBSCRIBE`)
- Inline kill (`x`) and clear (`c`) actions via `CHANNELS.COMMAND_KILL`/`COMMAND_CLEAR`
- Search, stream filter, follow mode, scroll
- Process picker when called without argument
- Completions for process IDs

**Config additions to core:**
- `processList`: `maxVisibleProcesses`, `maxPreviewLines`
- `output`: `defaultTailLines`, `maxOutputLines`
- `follow`: `enabledByDefault`, `autoHideOnFinish`

**Files:**
- `extensions/processes-logs/` — new directory
  - `index.ts`
  - `commands/logs.ts`
  - `components/log-overlay-component.ts`
  - `components/log-file-viewer.ts`
  - `components/process-picker-component.ts`
  - `components/status-format.ts`
  - `completions.ts`
  - `logs-client.ts`

**No dependency on `update` or dock.** Uses only `pi.events` channels.

## 3. processes-dock extension

**Commands:** `/ps:dock`, `/ps:pin`

**Scope:**
- Dock widget (above editor) with collapsed/open modes
- Status widget (below editor)
- `/ps:dock show|hide|toggle`
- `/ps:pin` to focus dock on a process
- Documented as a reference extension for building custom process UIs

**Config additions to core:**
- `widget`: `showStatusWidget`, `dockDefaultState`, `dockHeight`

**Files:**
- `extensions/processes-dock/` — new directory
  - `index.ts`
  - `commands/dock.ts`
  - `commands/pin.ts`
  - `components/log-dock-component.ts`
  - `widget/setup.ts`
  - `widget/status-widget.ts`
  - `widget/types.ts`
  - `dock-state.ts`
  - `logs-client.ts`

**No dependency on `update` or logs.** Uses only `pi.events` channels.

## 4. Final cleanup

- Update `package.json` extensions array
- Remove dead `skills/pi-processes` reference
- Import audit (src/ stays pi-agnostic, UI extensions don't import manager)
- Update AGENTS.md structure section

## Parallelism

Steps 2 and 3 are independent of each other and of step 1. They can be done in any order or in parallel. Step 1 is simplest and completes the LLM tool surface, so it goes first. Step 4 is last.
