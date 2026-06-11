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

## 5. Agent steering guidance

Tighten promptGuidelines and ship the skill to steer agents away from common mistakes. To be done after steps 2-3.

### promptGuidelines rewrite (~5 lines)
- Merge existing 8 lines into ~5 tighter ones
- Fold in: list before start, use watches not polling, use update not restart, output is for targeted inspection only, don't re-summarize tool output

### Skill: `skills/pi-processes/SKILL.md`
- Recreate (was removed in `58aad4b`)
- Expanded guidance with bad/good examples for common mistakes:
  - Polling output instead of setting watches
  - Restarting instead of updating watches
  - Starting duplicate processes
  - Not watching for common failure patterns (EADDRINUSE, etc.)
  - Re-summarizing tool output to the user
  - Using output for deep inspection (use logs/read instead)
  - Vague process names
  - Leaving obsolete processes running

### Steering text in tool output
- Add to `formatStartDetails` when watches are active: "Continue other work; watch notifications will trigger follow-up."
- Add to `formatOutputDetails` when process is still running: "Process is still running. Use watches instead of polling."

## Parallelism

Steps 2 and 3 are independent of each other. They can be done in any order or in parallel. Step 5 comes after both. Step 4 is last.
