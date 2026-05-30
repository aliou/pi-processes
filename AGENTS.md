# pi-processes

Public Pi extension that lets the agent run long-running commands in the
background without blocking the conversation. Ships a single LLM-facing
`process` tool, a set of `/ps:*` user commands, and always-visible TUI widgets
(status line + dock).

## Tool and command audience

The `process` tool and all `/ps:*` commands are for **LLM use only**, not for
users directly. Users can monitor processes via `/ps` and `/ps:logs` and kill
them via `/ps`, but they should never be the ones starting processes — that is
the agent's job.

During UI tests that require processes to be running, either give the user a
prompt to send to the agent (which starts the processes via the `process`
tool), or use tmux to drive it programmatically. Never instruct the user to run
shell commands manually.

## Mental model

`ProcessManager` (`src/manager.ts`) is the **single source of truth**. It
spawns child processes, tracks their state, tails their output to temp log
files, and emits events. Everything else (widgets, overlays, hooks, the tool,
the commands) only reacts to those events — nothing else owns process state.

```
process tool  ─┐
/ps:* commands ─┼─→ ProcessManager (spawns, tracks, emits) ─→ events ─→ hooks/widgets/overlays
                                    │
                                    └─→ temp log files (tmpdir) ←─ polled by dock @300ms
```

Events emitted by `ProcessManager` (`ManagerEvent` in `src/constants/types.ts`):
`process_started`, `process_output_changed`, `process_watch_matched`,
`process_ended`, `processes_changed`. See [EVENTS.md](./EVENTS.md) for the full
actor/event/flow map.

> Note: `EVENTS.md` flow diagrams use illustrative method names for dock state
> (`dockState.autoShow()` etc.). The real dock API is the `DockActions` object
> returned by `setupProcessWidget` in `src/hooks/widget/setup.ts` — there is no
> separate `DockStateManager` class or `src/state/` directory.

## How the agent should use the `process` tool

The tool is **push, not poll** — you never wait on or poll a process. You start
it, keep working, and get a turn back only when something you opted into fires.
Three notification controls on `start`:

- `alertOnFailure` (**default true**) — get a turn when the process crashes/exits non-zero.
- `alertOnSuccess` (default false) — get a turn on clean exit; use for builds/tests you must react to.
- `alertOnKill` (default false) — get a turn if killed by an external signal (killing via the tool never triggers a turn).
- `logWatches` — regex watches that alert *while the process is still running* (per match, not on exit). Each watch: `pattern`, `stream` (`stdout`/`stderr`/`both`, default both), `repeat` (default false = single-fire). `repeat: true` watches are turn-throttled (one turn per 5s, `REPEAT_WATCH_TURN_COOLDOWN_MS`) so a chatty pattern can't spam turns.

**logWatches coverage — silence is not success.** A watch that matches only the
"ready" / success marker stays silent if the process instead crashes or hangs,
and silence is indistinguishable from "still starting up." Process-exit failures
are already covered by `alertOnFailure: true`, but `logWatches` enforce nothing
— if you watch for a runtime condition, also watch for its failure signatures
(`Error`, `Traceback`, `FATAL`, etc.) or rely on the exit alert. (This is the
same coverage trap Claude Code's Monitor tool documents; pi-processes differs by
defaulting `alertOnFailure` on, so the exit path is covered even when a watch
is not.)

The seven actions (dispatched in `src/tools/index.ts` → `src/tools/actions/`):

| Action | Use |
|---|---|
| `start` | Spawn a background command (`name` + `command` required). Pass `cwd` instead of `cd dir && command`. |
| `list` | Snapshot of all processes with ids/statuses. |
| `output` | Recent stdout/stderr tail (fast, capped by config). |
| `logs` | Returns log file paths; read them with the `read` tool for full history. |
| `kill` | SIGTERM a process by id (escalates to SIGKILL). |
| `clear` | Drop finished processes from the list. |
| `write` | Send stdin to a running process (`end: true` closes stdin for EOF readers). |

## Process lifecycle (gotchas)

- Child processes are spawned as **process-group leaders**; kill targets the
  whole group (`pid` is also the PGID on Unix), so child trees die with the parent.
- Termination: `SIGTERM`, then `SIGKILL` after a ~3s grace
  (`terminating` → `terminate_timeout` → `killed`). See statuses in `src/constants/types.ts`.
- Output is **not** event-driven for the dock — logs stream to temp files under
  `tmpdir()/pi-processes-<timestamp>/`, and the dock polls them every 300ms.
  Only `logWatches` matches and start/end/clear emit events.
- `LIVE_STATUSES` = `running | terminating | terminate_timeout`.
- All processes are killed on session end (`src/hooks/cleanup.ts`).
- Windows is unsupported — the extension no-ops with a warning on `win32`.

## Structure

- `src/index.ts` — entry; wires config → manager → hooks → commands → tools.
- `src/manager.ts` — `ProcessManager`: spawn/track/kill, log tailing, events.
- `src/config.ts` — config schema + loader (`global` + `memory` scopes).
- `src/constants/` — `types.ts` (`ProcessInfo`, `ManagerEvent`, statuses) + constants.
- `src/tools/` — `index.ts` registers the `process` tool; `actions/` has one file per action.
- `src/commands/` — `/ps`, `/ps:logs`, `/ps:pin`, `/ps:kill`, `/ps:clear`, `/ps:dock`, `/ps:settings`.
- `src/hooks/` — lifecycle: `cleanup`, `process-end` (exit alerts), `process-watch` (logWatch alerts), `background-blocker` (optional shell interception), `message-renderer`, and `widget/` (status widget + dock, owns dock state via `DockActions`).
- `src/components/` — TUI: dock, log overlay, process picker, full `/ps` panel.
- `src/utils/` — ansi, command executor, process-group, shell, keybindings, format.
- `skills/pi-processes/` — shipped package skill (agent guidance, published).
- `.agents/skills/pi-processes-testing/` — repo-only dev/testing skill (not published).
- `test/` — manual process scripts (`test-output.sh`, `test-exit-*.sh`) for live behavior.

## Stack & versions

- TypeScript (strict, ESM), `pnpm@10.26.1`, Biome, Vitest, Changesets.
- `engines`: Node per the Pi peers (`>=22.19.0`).
- Published as `@aliou/pi-processes` to the public npm registry.

### Pi host peers are three minors behind

The `@earendil-works/pi-{ai,coding-agent,tui}` peers (declared optional `*`)
resolve to **0.75.3** in the lockfile — three minors behind the current Pi
monorepo **0.78.0**. The peer version, not the fork, is what's stale.

Every `ExtensionAPI` member this extension touches still exists in 0.78.0, so
an upgrade is API-compatible: `registerTool`, `registerCommand`,
`registerMessageRenderer`, `setWidget`, `sendMessage({ triggerTurn })`,
`on("session_start" | "session_shutdown" | "tool_call")`, and
`ctx.ui` / `hasUI` / `cwd`. Upgrade-relevant changes since 0.75.3:

- **0.77.0** — SIGTERM/SIGHUP now emit `session_shutdown` *before* terminal
  writes. The cleanup hook (`src/hooks/cleanup.ts`) kills processes on
  `session_shutdown`, so on 0.77+ background processes are reaped on signal
  exits, not only clean ones — fewer orphans on Ctrl-C.
- **0.77.0** — `--exclude-tools` lets users disable the `process` tool;
  `InputEvent.streamingBehavior` distinguishes idle / mid-stream-steer / queued input.
- `sendMessage` accepts `deliverAs: "steer" | "followUp" | "nextTurn"`. The
  process-end / process-watch hooks currently pass only the bare `triggerTurn`
  flag — `deliverAs` is an available, unused lever for finer turn delivery.

Confirm any Pi API against the installed peer version, not memory.

## Scripts

- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` / `pnpm format` — Biome check / `--write`
- `pnpm test` — Vitest (`*.test.ts`: manager, components, utils)
- `pnpm changeset` — add a release changeset

## Debug flags

- `PI_PROCESSES_DEBUG_PREVIEW=1` enables the temporary `process` tool action
  `debug_preview` for local renderer/UI preview work. Keep it off in normal use
  and user-facing examples.

## Common changes — where to start

- New tool action → add `src/tools/actions/<name>.ts`, wire in `actions/index.ts`, add to `PROCESS_ACTIONS` + schema in `src/tools/index.ts`, extend `ProcessAction`/`ProcessesDetails` in `src/constants/types.ts`.
- New `/ps:*` command → add `src/commands/<name>/`, register in `src/commands/index.ts`.
- Process behavior (spawn/kill/output) → `src/manager.ts` (keep it the only state owner).
- Dock/widget/overlay UX → `src/hooks/widget/` + `src/components/`. Read [EVENTS.md](./EVENTS.md) first.
- New setting → `src/config.ts` schema + `DEFAULT_CONFIG`, then `src/commands/settings/`.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for docs-build and demo conventions,
and [README.md](./README.md) for the user-facing feature tour.
