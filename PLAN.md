# pi-processes: Multi-Extension Rewrite Plan

## Overview

Rewrite `@aliou/pi-processes` from a single extension into a package exposing 4 extensions:
1. **processes** (core) -- owns the ProcessManager, tool, settings, hooks, event bridge, request/command handlers, message renderer
2. **processes-list** -- owns `/ps`, `/ps:kill`, `/ps:clear` and their TUI components
3. **processes-logs** -- owns `/ps:logs` and the log overlay/file viewer
4. **processes-dock** -- owns `/ps:dock`, `/ps:pin`, dock widget, status widget

The rewrite preserves the intended user-facing behavior, but the LLM-facing `process` tool is being restored incrementally. The current minimal tool supports `start`, `list`, and `stop`; later Phase 2 slices add log matchers, output/log access, clearing, and stdin writes.

---

## Principles

1. `src/` contains zero Pi imports. It is a pi-agnostic process management library.
2. `extensions/*/` contains all Pi-aware code.
3. The core extension owns one `ProcessManager` per extension instance. Phase 1 does not persist managers across `/reload`, `/new`, or `/fork`.
4. Inter-extension communication uses `pi.events` exclusively. UI extensions never import `ProcessManager` or `getManager()`.
5. Query/response uses synchronous callback payloads on named event channels.
6. All `pi.events` listeners are tracked and explicitly unsubscribed on `session_shutdown` to prevent leaks (the EventBus is never cleared by Pi).
7. Config and keybindings live in the core extension, not in `src/`.

---

## Phase Dependencies

```
Phase 1 (src/) --> Phase 2A (minimal core tool) --> Phase 2B (extension notifications)
                                                   --> Phase 2C (tool parity)
                                                   --> Phase 2E (event protocol)
                                                   --> Phase 2F (i18n bridge)
                                                   --> Phase 3 (list)
                                                   --> Phase 4 (logs)
                                                   --> Phase 5 (dock)
                                                               |
                                                     Phase 6 (cleanup)
```

Phases 3, 4, and 5 depend on Phase 2E because they communicate with the core extension through `pi.events`. Phase 4 and Phase 5 also depend on the log subscription protocol from Phase 2E. Phase 2F can happen any time after Phase 2A, but doing it before broad UI work avoids duplicating display copy.

---

## Current Implementation Status

Phase 1 is complete and verified.

Implemented and validated in Phase 1:
- Pi-agnostic `src/` foundation with zero Pi imports.
- Typed process domain types and event protocol.
- `ProcessManager` facade split into focused internal classes.
- Fresh-per-extension-instance `getManager()` factory.
- Cross-session persistence intentionally deferred and documented in `docs/future-persistent-manager.md`.
- Structured output chunk events with `appendedText?: Array<{ type, text }>`.
- Manager alert/watch policy removed: `src/` has no `alertOn*`, no `logWatches`, no `addLogWatches()`, and no `process_watch_matched` event. Log matching and notification reactions are extension concerns.
- Stdin writing through `ProcessManager.writeToStdin()`.
- Finished-process cleanup through `ProcessManager.clearFinished()`.
- `memfs` filesystem mocks via `__mocks__/fs.cjs` and `__mocks__/fs/promises.cjs`.
- Unit tests for manager facade, manager internals, get-manager, and command executor.
- Manager facade tests mock process spawning at the `spawnCommand()` wrapper boundary; they do not launch real processes.

Phase 2A is complete and verified.

Implemented and validated in Phase 2A:
- Minimal core extension at `extensions/processes/index.ts`.
- `package.json` points Pi at `./extensions/processes/index.ts` and includes `extensions` in package files.
- Minimal `process` tool registered from `extensions/processes/tools/index.ts`.
- Tool actions implemented: `start`, `list`, `stop`.
- `stop` is the LLM-facing name; internally it maps to `ProcessManager.kill()`.
- `list` supports display-layer sorting, status filtering, and limiting. The manager/registry returns insertion order and does not apply UI sorting.
- Tool rendering uses per-action render modules and reusable components under `extensions/processes/tools/components/`.
- Shared truncation helper lives at `extensions/processes/utils/truncate.ts`.
- Session shutdown cleanup kills and cleans up the extension-owned manager instance.
- Manual scenario prompts live under `tests/scenarios/`.

Latest validation:
- `pnpm typecheck` passes.
- `pnpm lint` passes.
- `pnpm test` passes with 7 files and 87 tests.

Current intentional gaps:
- No settings/config loader yet.
- No event bridge or request/command/subscription handlers yet.
- No process notification model, `pi.sendMessage()` hooks, or message renderer yet.
- No background command blocker yet.
- No process-exit/SIGINT/SIGTERM manager registry yet.
- No list/logs/dock UI extensions yet.
- Tool parity is incomplete: `output`, `logs`, `clear`, and `write` are not implemented yet.
- `package.json` still references `./skills/pi-processes`, but the local `skills/` directory is absent. Either restore the skill later or remove the `pi.skills`/`files` entries during cleanup.
- `debug-preview` is intentionally removed from the plan.

Integrated decisions:
1. Cross-session persistence is deferred. It is not a `ProcessManager` option, not a process field, and not a tool parameter.
2. `ProcessManager` is split into internal classes for registry, logs, output tracking, output notification, and runtime control.
3. `process_output_changed` carries structured appended lines, not a plain string.
4. `ManagedProcessRecord` is an internal mutable runtime record; public consumers receive `ProcessInfo` snapshots produced by `formatProcess()`.
5. Alerts, log matching, and notification reactions are not manager concepts. Extensions consume lifecycle/output events, write process notification custom messages, and decide whether those messages trigger an agent turn.
6. Filesystem tests use `memfs` through `__mocks__`; process-spawn tests mock `spawnCommand()` and fake child-process streams/events.
7. `docs/future-persistent-manager.md` is the only place for future persistence design notes.
8. Process storage APIs return insertion order. Sorting belongs in tool/UI layers.
9. The LLM-facing tool uses `stop`; internal manager/protocol operations may still use `kill` because they send process signals.
10. The extension should not implement `debug-preview`.

---

## Directory Structure

Current implemented extension structure:

```
extensions/
  processes/
    index.ts
    hooks/
      cleanup.ts
    tools/
      index.ts
      schema.ts
      utils.ts
      components/
        index.ts
        process-action-header.ts
        process-action-title.ts
        tool-layout.ts
      start/
        index.ts
        render.ts
      list/
        index.ts
        render.ts
      stop/
        index.ts
        render.ts
    utils/
      truncate.ts

tests/
  scenarios/
    01-basic-start-list/
    02-stop-flow/
    03-multiple-processes/
    04-duplicate-avoidance/
    05-error-paths/
    06-no-shell-backgrounding/
    07-reload-cleanup/
    08-smoke-test/
```

Planned final structure:

```
src/
  types.ts
  protocol.ts
  get-manager.ts
  get-manager.test.ts
  manager/
    index.ts
    index.test.ts
    internal-types.ts
    process-registry.ts
    process-registry.test.ts
    process-log-store.ts
    process-log-store.test.ts
    process-output.ts
    process-output.test.ts
    process-runtime-controller.ts
  utils/
    index.ts
    ansi.ts
    command-executor.ts
    command-executor.test.ts
    format.ts
    process-group.ts
    shell-utils.ts

__mocks__/
  fs.cjs
  fs/
    promises.cjs

docs/
  future-persistent-manager.md

extensions/
  processes/
    index.ts
    config.ts
    i18n.ts
    notification-sender.ts
    tools/
      index.ts
      schema.ts
      utils.ts
      components/
      start/
      list/
      stop/
      output/
      logs/
      clear/
      write/
    hooks/
      cleanup.ts
      exit.ts
      process-notifications.ts
      background-blocker.ts
      event-bridge.ts
    handlers/
      requests.ts
      commands.ts
      subscriptions.ts
    message-renderer.ts
    settings/
      index.ts
      build-sections.ts
      apply-setting-change.ts

  processes-list/
    index.ts
    commands/
      ps.ts
      kill.ts
      clear.ts
    components/
      processes-component.ts
      process-picker-component.ts
      status-format.ts
    completions.ts
    helpers.ts

  processes-logs/
    index.ts
    commands/
      logs.ts
    components/
      log-overlay-component.ts
      log-file-viewer.ts
    logs-client.ts

  processes-dock/
    index.ts
    commands/
      dock.ts
      pin.ts
    components/
      log-dock-component.ts
    widget/
      setup.ts
      status-widget.ts
      types.ts
    dock-state.ts
    logs-client.ts
```

Notes:
- The extension tool directory is `tools/`, not `tool/`.
- The `debug-preview` action is intentionally not part of the final structure.
- The LLM-facing tool action is `stop`; UI commands can still use `/ps:kill`.

---

## Phase 1: `src/` Foundation (pi-agnostic)

### Goal

All pi-agnostic process management code lives in `src/`. It can be used as a standalone library with no knowledge of Pi.

### Files

#### `src/types.ts`

All domain types for process management.

Types to define:

```
ProcessStatus       = "running" | "terminating" | "terminate_timeout" | "exited" | "killed"
LIVE_STATUSES       = Set<ProcessStatus> containing "running", "terminating", "terminate_timeout"

ProcessInfo {
  id: string
  name: string
  pid: number
  command: string
  cwd: string
  startTime: number
  endTime: number | null
  status: ProcessStatus
  exitCode: number | null
  success: boolean | null
  stdoutFile: string
  stderrFile: string
}

ManagerEvent =
  | { type: "process_started"; info: ProcessInfo }
  | { type: "process_ended"; info: ProcessInfo }
  | { type: "process_output_changed"; id: string; appendedText?: Array<{ type: "stdout" | "stderr"; text: string }> }
  | { type: "processes_changed" }

KillResult =
  | { ok: true; info: ProcessInfo }
  | { ok: false; info: ProcessInfo; reason: "not_found" | "timeout" | "error" }

WriteResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "process_exited" | "stdin_closed" | "write_error" }
```

Current type boundary:
- `ProcessInfo` does NOT include `persistent`, `alertOn*`, notification config, or log matcher config.
- There is no `StartOptions` type in `src/`; `ProcessManager.start()` accepts only name, command, and cwd.
- `process_output_changed` includes optional `appendedText?: Array<{ type, text }>` for extension-owned log matching and log subscription fanout.
- There is no manager-level watch event. Pattern matching and reactions belong in `extensions/processes/`.
- `MESSAGE_TYPE_PROCESS_UPDATE` belongs in the core extension (it is a Pi concept).
- `ProcessAction`, `ProcessesDetails`, `ExecuteResult`, and notification config belong to the core extension tool directory (they are tool-specific, not manager-level).

#### `src/protocol.ts`

Typed event protocol for inter-extension communication. No Pi imports. Just type definitions and channel name constants.

Channel name constants:

```ts
export const CHANNELS = {
  // Core broadcasts
  STARTED:         "processes:started",
  ENDED:           "processes:ended",
  OUTPUT_CHANGED:  "processes:output_changed",
  CHANGED:         "processes:changed",

  // Request channels (UI -> core, sync callback)
  REQUEST_LIST:            "processes:request:list",
  REQUEST_GET:             "processes:request:get",
  REQUEST_OUTPUT:          "processes:request:output",
  REQUEST_COMBINED_OUTPUT: "processes:request:combined_output",
  REQUEST_LOG_FILES:       "processes:request:log_files",
  REQUEST_FILE_SIZE:       "processes:request:file_size",
  REQUEST_CONFIG:          "processes:request:config",

  // Command channels (UI -> core, callback)
  COMMAND_KILL:            "processes:command:kill",
  COMMAND_CLEAR:           "processes:command:clear",

  // Log subscription channels
  LOGS_SUBSCRIBE:   "processes:logs:subscribe",
  LOGS_UNSUBSCRIBE: "processes:logs:unsubscribe",
  LOGS_CHUNK:       "processes:logs:chunk",
} as const;
```

Payload types for each channel:

**Broadcast payloads** (core emits, UI listens):

```
ProcessesStartedPayload     = ProcessInfo
ProcessesEndedPayload       = ProcessInfo
ProcessesOutputChangedPayload = { id: string; appendedText?: Array<{ type: "stdout" | "stderr"; text: string }> }
ProcessesChangedPayload     = { reason: "started" | "ended" | "cleared" }
```

**Request payloads** (UI emits, core listens and calls `reply` synchronously):

```
RequestListPayload = {
  reply: (processes: ProcessInfo[]) => void
}

RequestGetPayload = {
  id: string
  reply: (info: ProcessInfo | null) => void
}

RequestOutputPayload = {
  id: string
  tailLines?: number
  reply: (output: { stdout: string[]; stderr: string[]; status: string } | null) => void
}

RequestCombinedOutputPayload = {
  id: string
  tailLines?: number
  reply: (lines: Array<{ type: "stdout" | "stderr"; text: string }> | null) => void
}

RequestLogFilesPayload = {
  id: string
  reply: (files: { stdoutFile: string; stderrFile: string; combinedFile: string } | null) => void
}

RequestFileSizePayload = {
  id: string
  reply: (sizes: { stdout: number; stderr: number } | null) => void
}

RequestConfigPayload = {
  reply: (config: unknown) => void
}
```

**Command payloads** (UI emits, core handles then calls `reply`):

```
CommandKillPayload = {
  id: string
  signal?: NodeJS.Signals
  timeoutMs?: number
  reply: (result: KillResult) => void
}

CommandClearPayload = {
  reply: (cleared: number) => void
}
```

**Log subscription payloads**:

```
LogsSubscribePayload = {
  subscriberId: string
  processId: string
  reply: (result:
    | { ok: true; initialLines: Array<{ type: "stdout" | "stderr"; text: string }>; }
    | { ok: false; error: string }
  ) => void
}

LogsUnsubscribePayload = {
  subscriberId: string
}

LogsChunkPayload = {
  subscriberId: string
  processId: string
  lines: Array<{ type: "stdout" | "stderr"; text: string }>
}
```

Helper functions for typed emit/listen (optional but recommended):

```ts
export function emitRequest(events: EventBus, channel: string, payload: unknown): void {
  events.emit(channel, payload);
}
```

These are thin wrappers that provide type safety at call sites without introducing Pi dependencies.

#### `src/utils/ansi.ts`

Unchanged from current implementation.

Exports:
- `stripAnsi(str: string): string`
- `hasAnsi(str: string): boolean`

#### `src/utils/process-group.ts`

Unchanged from current implementation.

Exports:
- `isProcessGroupAlive(pgid: number): boolean`
- `killProcessGroup(pgid: number, signal: NodeJS.Signals): void`

#### `src/utils/command-executor.ts`

Unchanged from current implementation.

Exports:
- `resolveShellExecutable(opts): string`
- `spawnCommand(command, cwd, configuredShell?): ChildProcess`

#### `src/utils/command-executor.test.ts`

Unchanged from current implementation. Adjust imports if paths change.

#### `src/utils/shell-utils.ts`

Unchanged from current implementation. Used by the background blocker hook in the core extension.

Exports:
- `wordToString(word: Word): string`
- `walkCommands(node: Program, callback): void`

#### `src/utils/format.ts`

Plain-string formatting only. No `Theme` import. No pi-tui import.

Exports:
- `formatRuntime(startTime: number, endTime: number | null): string` -- "3s", "2m 15s", "1h 30m"
- `formatStatus(proc: { status: string; success: boolean | null; exitCode: number | null }): string` -- "running", "exit(0)", "exit(1)"
- `truncateCmd(cmd: string, max?: number): string`
- `formatTimestamp(ts: number | null): string` -- ISO timestamp or "-"

`formatStatusTag` (which uses Theme) moves to `extensions/processes-list/components/status-format.ts`.

#### `src/utils/index.ts`

Barrel re-exports from all util modules.

#### `src/manager/`

The core `ProcessManager` implementation lives in a directory, not a single `src/manager.ts` file. The public import path remains `./manager` through `src/manager/index.ts`.

Files:
- `index.ts` -- public `ProcessManager` facade, event subscription API, public query/command methods, cleanup.
- `internal-types.ts` -- `ManagedProcessRecord`, log paths, internal state interfaces, and `formatProcess()`.
- `process-registry.ts` -- ID generation, process storage, public listing, live-process iteration.
- `process-log-store.ts` -- log path creation, file append/read/tail, combined output parsing, log cleanup.
- `process-output.ts` -- stdout/stderr chunk parsing, partial-line flushing, combined log append, appended-line draining, and throttled output-change events.
- `process-runtime-controller.ts` -- spawn, stdio wiring, exit/error transitions, kill/write/clear operations, liveness watcher.

Public API:
- `start()`, `list()`, `get()`
- `getOutput()`, `getCombinedOutput()`, `getFullOutput()`, `getLogFiles()`, `getFileSize()`
- `kill()`, `killAll()`, `writeToStdin()`, `clearFinished()`
- `onEvent()`, `stopWatcher()`, `cleanup()`, `[Symbol.dispose]()`

Important rules:
1. Constructor is pure process lifecycle. No `persistent` option. The manager does not know about Pi sessions, reloads, or extension lifetime.
2. No `setPersistence()`, `isPersistent()`, or `killNonPersistent()` on `ProcessManager`.
3. The extension instance owns shutdown and calls `manager.killAll()` and `manager.cleanup()` on `session_shutdown`.
4. `killAll()` kills all live processes. It is used by session shutdown and process-exit cleanup.
5. `process_output_changed` optionally includes `appendedText` (completed lines since the last emit). This is used by log subscriptions and extension-owned log matching without re-reading files.
6. Internal mutable state stays in `ManagedProcessRecord`; public callers only receive `ProcessInfo` snapshots via `formatProcess()`.
7. The manager does not store alert preferences, compile matchers, or emit watch-match events.

The manager does NOT know about:
- Pi extension API
- Pi events
- Pi sessions
- Pi TUI/themes
- Alert/notification reactions
- Log pattern matching

#### Manager tests

Tests live next to the classes they cover:

- `src/manager/index.test.ts`
- `src/manager/process-registry.test.ts`
- `src/manager/process-log-store.test.ts`
- `src/manager/process-output.test.ts`
- `src/get-manager.test.ts`

Coverage includes:
- Start/list/get basics
- Process lifecycle events (started, ended, output_changed, processes_changed)
- Output throttling
- Manager lifetime and cleanup
- `clearFinished()` emits `processes_changed`
- Kill result variants (ok, timeout, not_found)
- Write to stdin (ok, closed, not found)
- Registry behavior
- Log store behavior with `memfs`
- Output line parsing, appended-line buffering, throttling, flush, and clear behavior
- `getManager()` fresh-instance factory behavior

The manager facade tests mock process spawning at the `spawnCommand()` wrapper boundary and use fake `ChildProcess` streams/events. They do not launch real processes.

#### `src/get-manager.ts`

Small factory for creating a manager for the current extension instance.

```ts
import { ProcessManager } from "./manager";

export function getManager(
  opts?: ConstructorParameters<typeof ProcessManager>[0]
): ProcessManager {
  return new ProcessManager(opts);
}
```

Each extension load creates its own manager with the provided options (for example `getConfiguredShellPath`). If the shell path config changes, the manager reads it lazily via the callback, so the callback closure captures `configLoader.getConfig()` and sees the latest config for that extension instance.

### Phase 1 Verification

Phase 1 is complete. Current verification command:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected result:
- TypeScript passes.
- Biome passes.
- Vitest passes all `src/**/*.test.ts` tests.

Additional audits:
1. Confirm zero Pi imports in any `src/` file:
   ```bash
   grep -r "pi-coding-agent\|pi-tui\|pi-utils" src/
   ```
   Should return nothing.
2. Confirm `getManager()` returns a fresh instance on each call.
3. Confirm manager facade tests do not spawn real processes.

---

## Phase 2: Core Extension (`extensions/processes/`)

### Goal

The core extension is the only extension that touches `ProcessManager` directly through `getManager()`. It bridges the manager into Pi's world: registers the LLM-facing tool, handles settings, sends agent notifications, and exposes the event protocol for the list/logs/dock extensions.

Phase 2 is intentionally split into smaller slices. Phase 2A is already complete. The next implementation slice is Phase 2B: extension-owned notifications. The manager now emits only neutral lifecycle/output/change events; log matching and alert reactions must live in the core extension.

---

### Phase 2A: Minimal core tool extension — complete

Implemented files:
- `extensions/processes/index.ts`
- `extensions/processes/hooks/cleanup.ts`
- `extensions/processes/tools/index.ts`
- `extensions/processes/tools/schema.ts`
- `extensions/processes/tools/utils.ts`
- `extensions/processes/tools/components/*`
- `extensions/processes/tools/start/*`
- `extensions/processes/tools/list/*`
- `extensions/processes/tools/stop/*`
- `extensions/processes/utils/truncate.ts`

Implemented behavior:
1. Create one manager for the extension instance via `getManager()`.
2. Register the `process` tool.
3. Support `process start`.
4. Support `process list` with display-layer sort/filter/limit.
5. Support `process stop`, which maps to `manager.kill()`.
6. Kill and clean up the same manager instance on `session_shutdown`.
7. Render tool calls/results through reusable TUI components.
8. Keep manager/registry list ordering as insertion order; UI/tool code owns sorting.

Current `process` tool schema:
- `action`: `"start" | "list" | "stop"`
- `name`: required for `start`
- `command`: required for `start`
- `id`: required for `stop`
- `limit`: optional for `list`
- `sortBy`: optional for `list`
- `statuses`: optional for `list`

Phase 2A intentionally does not include settings, event bridge, notifications, output/log actions, clear, write, or UI commands.

---

### Phase 2B: Process notifications — next

Goal: introduce manager end-cause metadata and a core-extension notification model that reacts to neutral manager events. This replaces manager-level `alertOn*` flags and manager-level log watches.

The detailed implementation plan lives in [`docs/process-notifications-plan.md`](docs/process-notifications-plan.md). That document is authoritative for this phase.

High-level decisions:
- `ProcessManager.start()` does not accept alert, notify, or watch options.
- `ProcessInfo` does not contain notification preferences.
- The manager does not match log patterns and does not emit `process_watch_matched`.
- The manager should expose neutral end-cause facts (`endReason`, `signal`, `errorMessage`) so the extension can classify crashes/failures accurately.
- Signals should be serialized as a small `{ name, number, description }` snapshot, not as runtime objects.
- The extension consumes `process_ended` and `process_output_changed.appendedText` to decide notification behavior.
- Agent-facing `notify` config controls agent attention only: `"turn"`, `"context"`, or `"ignore"`.
- Display is not agent-controlled. For the initial implementation, all emitted process notification messages use `display: true`.
- Process notifications are persisted as Pi custom messages via `pi.sendMessage()`, not as widgets or `ctx.ui.notify()`, so resume/export still shows them.
- Context-without-turn uses a custom message with `triggerTurn: false` and `deliverAs: "nextTurn"`; do not use the Pi `context` event for this.
- Notification message content should use an XML-like process-event envelope so the agent can distinguish process events from user messages.
- `extensions/processes/message-renderer.ts` customizes TUI rendering for `ad-process:notification` messages.

Phase 2B implementation slices:
1. Add manager end-cause metadata. See `docs/process-notifications-plan.md#manager-update-end-cause-metadata`.
2. Add notification message infrastructure: constants, normal notification sender, XML content builder, custom message renderer.
3. Add notification registry/service: classify process ends, compile/evaluate log matchers from `appendedText`, track intentional stops, and send custom messages.
4. Add `notify` to the `process start` tool schema with attention-only values.
5. Update `process stop` to mark intentional stops before calling `manager.kill()`.
6. Add tests/scenarios for end causes, lifecycle notifications, context notifications, log matches, invalid regex, and intentional-stop suppression.

---

### Phase 2C: Tool parity

Goal: restore the useful LLM-facing tool actions without adding the UI extensions yet.

Actions to add:

#### `output`

Purpose: return recent process output directly in the tool result.

Manager API:
- `manager.getOutput(id, tailLines)` returns `{ stdout, stderr, status } | null`.

Use when:
- The agent needs a quick recent stdout/stderr snapshot.
- The output is small enough to render directly.

#### `logs`

Purpose: return log file paths for large/full-log access.

Manager API:
- `manager.getLogFiles(id)` returns `{ stdoutFile, stderrFile, combinedFile } | null`.

Use when:
- The agent needs to inspect a large log with the `read` tool.
- The agent needs complete logs rather than a small tail.

Important distinction:
- `output` returns output content.
- `logs` returns file paths.
- The future `/ps:logs` UI should not depend on the `logs` tool. It should use the request/subscription protocol from Phase 2E.

#### `clear`

Purpose: remove finished process records and delete their log files.

Manager API:
- `manager.clearFinished()` returns the number cleared.

Recommendation:
- Keep `clear` in the core command protocol and `/ps:clear` UI.
- Add the LLM-facing `clear` tool action if it is useful for long sessions, but it is lower priority than `output`, `logs`, and log matchers.

#### `write`

Purpose: write data to a running process's stdin.

Manager API:
- `manager.writeToStdin(id, data, { end })`.

Recommendation:
- Keep and expose it eventually. The manager already supports it and tests cover it.
- Useful for REPLs, prompts, interactive scripts, and commands waiting for confirmation.
- It is lower priority than log matchers and output/log readback.

Not planned:
- `debug-preview`. This action is intentionally removed from the plan.

---

### Phase 2E: Core event protocol and subscriptions

Goal: expose the manager to UI extensions without letting those extensions import `ProcessManager` or `getManager()`.

Files:
- `extensions/processes/hooks/event-bridge.ts`
- `extensions/processes/handlers/requests.ts`
- `extensions/processes/handlers/commands.ts`
- `extensions/processes/handlers/subscriptions.ts`

Event bridge:
- `process_started` -> `CHANNELS.STARTED`
- `process_ended` -> `CHANNELS.ENDED`
- `process_output_changed` -> `CHANNELS.OUTPUT_CHANGED`
- `processes_changed` -> `CHANNELS.CHANGED`

Request handlers:
- `CHANNELS.REQUEST_LIST` -> `manager.list()`
- `CHANNELS.REQUEST_GET` -> `manager.get(id)`
- `CHANNELS.REQUEST_OUTPUT` -> `manager.getOutput(id, tailLines)`
- `CHANNELS.REQUEST_COMBINED_OUTPUT` -> `manager.getCombinedOutput(id, tailLines)`
- `CHANNELS.REQUEST_LOG_FILES` -> `manager.getLogFiles(id)`
- `CHANNELS.REQUEST_FILE_SIZE` -> `manager.getFileSize(id)`
- `CHANNELS.REQUEST_CONFIG` -> resolved config once config exists

Command handlers:
- `CHANNELS.COMMAND_KILL` -> `manager.kill(id, { signal, timeoutMs })`
- `CHANNELS.COMMAND_CLEAR` -> `manager.clearFinished()`

Log subscription protocol:
1. UI extension emits `CHANNELS.LOGS_SUBSCRIBE` with `{ subscriberId, processId, reply }`.
2. Core validates the process and returns initial combined output lines.
3. Core stores `{ subscriberId, processId }` in a subscriber map.
4. On `process_output_changed`, core emits `CHANNELS.LOGS_CHUNK` to matching subscribers.
5. UI extension emits `CHANNELS.LOGS_UNSUBSCRIBE` on close/tab switch/shutdown.
6. Core clears the subscriber map on `session_shutdown`.

Session shutdown ordering:
1. Mark this extension instance as shutting down so duplicate shutdown events are ignored.
2. Call all disposers to remove pi.events listeners, manager.onEvent listeners, log subscribers, and process-exit registry entries.
3. Call `manager.killAll()`.
4. Call `manager.cleanup()`.

---

### Phase 2F: Settings, background blocker, exit hooks, and i18n bridge

This phase can be split further if it grows.

#### Settings/config

Add:
- `extensions/processes/config.ts`
- `extensions/processes/settings/index.ts`
- `extensions/processes/settings/build-sections.ts`
- `extensions/processes/settings/apply-setting-change.ts`

Config sections:
- `processList` -- maxVisibleProcesses, maxPreviewLines
- `output` -- defaultTailLines, maxOutputLines
- `execution` -- shellPath
- `widget` -- showStatusWidget, dockDefaultState, dockHeight
- `follow` -- enabledByDefault, autoHideOnFinish
- `keybindings` -- keybinding overrides
- `interception` -- blockBackgroundCommands

#### Background blocker

Add `extensions/processes/hooks/background-blocker.ts`.

Behavior:
- Listen for bash tool calls.
- Detect background shell patterns such as `&`, `nohup`, `disown`, and `setsid`.
- Return a blocking reason that tells the agent to use the `process` tool instead.
- Register only when `config.interception.blockBackgroundCommands` is enabled.

#### Exit hooks

Add `extensions/processes/hooks/exit.ts`.

Behavior:
- Keep a global set of live extension-owned managers.
- Attach one-time handlers for `exit`, `SIGINT`, and `SIGTERM`.
- On process exit, kill all registered live managers.
- Return an unregister function for session cleanup.

#### i18n bridge

This is inspired by GitHub PR #34, which proposed a small localization bridge for high-risk list/kill copy.

Recommendation:
- Keep i18n out of `src/`.
- Add `extensions/processes/i18n.ts` for Pi-facing text only.
- Keep protocol payloads structured and language-neutral.
- Renderers/components call a translator function with stable keys and params.
- Provide English fallbacks in the package.
- Start narrow: status labels, list summaries, stop/kill result copy, and warning/error guidance.

Sketch:

```ts
type MessageKey =
  | "process.list.empty"
  | "process.list.summary"
  | "process.stop.not_found"
  | "process.stop.timeout"
  | "process.status.running"
  | "process.status.exited"
  | "process.status.failed"
  | "process.status.killed";

type Translator = (
  key: MessageKey,
  params?: Record<string, unknown>,
) => string;
```

Open design questions:
- Does Pi expose a locale or i18n provider we should consume?
- Should extension packages expose their own translator hook through `pi.events`?
- Should list/logs/dock extensions share a core translator, or each carry its own small English fallback?

Default recommendation until Pi has a standard provider:
- Export a small `createTranslator(overrides?)` helper from the core extension area.
- UI extensions import only i18n helpers, not `ProcessManager`.
- Do not localize protocol channel names, statuses, or structured event values.

---

### Phase 2 Verification

After Phase 2B:
1. Manager end-cause metadata is present on `ProcessInfo` and covered by tests.
2. Start a process with `notify` attention config.
3. Confirm failure defaults to `turn` and success defaults to `context`.
4. Confirm context notifications create displayed custom messages with `triggerTurn: false` and `deliverAs: "nextTurn"`.
5. Confirm turn notifications create displayed custom messages with `triggerTurn: true` and `deliverAs: "steer"`.
6. Confirm notification content uses the XML-like process-event envelope described in `docs/process-notifications-plan.md`.
7. Confirm the custom message renderer displays `ad-process:notification` messages distinctly in the TUI.
8. Confirm intentional `process stop` suppresses the killed lifecycle notification.
9. Confirm a matching stdout/stderr line from `appendedText` sends a log-match notification.
10. Confirm repeat matchers are turn-rate-limited.
11. Confirm invalid regex input produces a useful tool error.

After Phase 2C:
1. Tool actions work: `start`, `list`, `stop`, `output`, `logs`, `clear`, `write`.
2. `output` returns recent content.
3. `logs` returns readable file paths.
4. `write` can send stdin and optionally close stdin.

After Phase 2E:
1. Core emits lifecycle/output/change events over `pi.events`.
2. Request handlers reply synchronously.
3. Command handlers kill/clear through the manager.
4. Log subscriptions receive initial lines and live chunks.
5. Session shutdown removes listeners before killing processes.

After Phase 2F:
1. `/ps:settings` works.
2. Background blocker works when enabled.
3. Exit hooks kill live processes on process exit.
4. i18n helper has English fallbacks and does not leak localized text into protocol payloads.

---

## Phase 3: List Extension (`extensions/processes-list/`)

### Goal

Own the process list TUI (`/ps`), kill command (`/ps:kill`), and clear command (`/ps:clear`).

### Files

#### `extensions/processes-list/index.ts`

Entry point. Registers three commands.

```ts
export default function(pi: ExtensionAPI): void
```

Registers:
- `/ps` command -> `commands/ps.ts`
- `/ps:kill` command -> `commands/kill.ts`
- `/ps:clear` command -> `commands/clear.ts`

Subscribes to pi.events lifecycle events to keep internal state fresh (if components need it).

Tracks disposers, cleans up on session_shutdown.

#### `extensions/processes-list/commands/ps.ts`

The `/ps` command handler. Opens the ProcessesComponent as a custom UI.

When the user selects a process and presses Enter, it returns the process ID. The current implementation uses this to set dock focus via `dockActions.setFocus(processId)`. In the new architecture, the list extension should emit an event or let the dock extension handle this. Options:
- Emit a `processes:dock:focus` event that the dock extension listens for.
- Or simply return the selected process ID and let the caller decide.

For simplicity, the `/ps` command can emit `processes:dock:focus` when a process is selected. The dock extension listens for this. If the dock extension is not loaded, the event is simply ignored.

#### `extensions/processes-list/commands/kill.ts`

The `/ps:kill` command handler.

Flow:
1. If arg provided, resolve process ID.
2. If no arg and only one running process, use that.
3. If no arg and multiple running, show ProcessPickerComponent.
4. Emit `CHANNELS.COMMAND_KILL` with `{ id, reply }`.
5. On success, optionally emit dock focus clear.

To get the process list for completions and picker, emits `CHANNELS.REQUEST_LIST`.

For kill of a `terminate_timeout` process, uses SIGKILL instead of SIGTERM.

#### `extensions/processes-list/commands/clear.ts`

The `/ps:clear` command handler.

Emits `CHANNELS.COMMAND_CLEAR` with `{ reply }`.

#### `extensions/processes-list/components/processes-component.ts`

Rewrite of current `src/components/processes-component.ts`.

Changes:
- Instead of `this.manager.list()`, emits `CHANNELS.REQUEST_LIST` and uses the reply.
- Instead of `this.manager.getOutput()`, emits `CHANNELS.REQUEST_OUTPUT`.
- Instead of `this.manager.getFileSize()`, emits `CHANNELS.REQUEST_FILE_SIZE`.
- Instead of `this.manager.onEvent()`, listens on pi.events for `CHANNELS.CHANGED`, `CHANNELS.OUTPUT_CHANGED`, etc.
- Instead of `this.manager.kill()`, emits `CHANNELS.COMMAND_KILL`.
- Instead of `this.manager.clearFinished()`, emits `CHANNELS.COMMAND_CLEAR`.

The component receives `pi.events` (the EventBus) instead of the ProcessManager.

Config values (maxVisibleProcesses, maxPreviewLines) are obtained via `CHANNELS.REQUEST_CONFIG`.

#### `extensions/processes-list/components/process-picker-component.ts`

Rewrite of current `src/components/process-picker-component.ts`.

Same pattern: uses pi.events instead of direct manager access.

#### `extensions/processes-list/components/status-format.ts`

Moved from `src/components/status-format.ts`. Contains:
- `statusLabel(proc: ProcessInfo): string`
- `statusIcon(status: ProcessStatus, success: boolean | null): string`

Also contains `formatStatusTag(proc, theme): string` which was previously in `src/utils/format.ts` but uses Theme, so it belongs here.

#### `extensions/processes-list/completions.ts`

Provides argument completions for commands that take a process ID.

Emits `CHANNELS.REQUEST_LIST` to get the current process list, then filters.

Exports:
- `runningProcessCompletions(events: EventBus): (prefix: string) => AutocompleteItem[]`
- `allProcessCompletions(events: EventBus): (prefix: string) => AutocompleteItem[]`

#### `extensions/processes-list/helpers.ts`

Shared helpers for this extension. E.g., `pickProcess()` function that opens the picker component.

### Phase 3 Verification

1. `/ps` shows process list, updates in real time.
2. `/ps:kill` kills processes. Handles single-running and multi-running cases.
3. `/ps:clear` clears finished processes.
4. No direct `ProcessManager` imports anywhere in this extension.
5. Autocomplete works for process IDs.

---

## Phase 4: Logs Extension (`extensions/processes-logs/`)

### Goal

Own the log viewer overlay (`/ps:logs`).

### Files

#### `extensions/processes-logs/index.ts`

Entry point. Registers `/ps:logs`.

Tracks disposers, cleans up on session_shutdown.

#### `extensions/processes-logs/commands/logs.ts`

The `/ps:logs` command handler. Opens the LogOverlayComponent as a custom overlay UI.

If an argument is provided, pre-selects that process. Uses `CHANNELS.REQUEST_GET` to validate the process exists.

For argument completions, uses `CHANNELS.REQUEST_LIST` (same pattern as list extension).

#### `extensions/processes-logs/components/log-overlay-component.ts`

Rewrite of current `src/components/log-overlay-component.ts`.

Major change: instead of directly calling `manager.getLogFiles()` and reading files with LogFileViewer, it uses the log subscription protocol:

1. On tab select (process selected), emit `CHANNELS.LOGS_SUBSCRIBE` with a new subscriberId.
2. Receive initial lines in the reply callback.
3. Listen for `CHANNELS.LOGS_CHUNK` events, filter by subscriberId.
4. On tab switch, emit `CHANNELS.LOGS_UNSUBSCRIBE` for the old subscription, create new one.
5. On close, emit `CHANNELS.LOGS_UNSUBSCRIBE`.

The overlay still needs `CHANNELS.REQUEST_LIST` to get the process list for tabs.

It listens to `CHANNELS.CHANGED` to detect new/removed processes and update the tab bar.

Features to preserve:
- Tabbed view with tab bar
- Search (/, n, N, Escape)
- Stream filter (s to cycle stdout/stderr/combined)
- Follow mode (f to toggle)
- Scroll (j/k, g/G)
- Keyboard navigation (Tab/Shift+Tab for tab switching)
- Auto-close when all processes cleared

#### `extensions/processes-logs/components/log-file-viewer.ts`

Rewrite of current `src/components/log-file-viewer.ts`.

This component needs to change significantly. Currently it reads a log file directly. In the new architecture, it receives lines from the subscription protocol instead.

New interface:
- Receives initial lines on creation
- Has an `appendLines(lines)` method called when new chunks arrive
- Retains all current rendering/scrolling/search/follow logic but operates on an in-memory line buffer instead of reading from disk

If the overlay needs to re-read the full file (e.g., for stream filter changes), it can unsubscribe, change filter, and re-subscribe.

Alternatively, the log subscription can always send combined-format lines and the viewer filters locally. This is simpler and matches current behavior where the viewer reads the combined file and filters by stream. Decide during implementation.

**Recommended approach:** Log subscriptions always send combined-format lines (with type: "stdout" | "stderr"). The viewer maintains an in-memory buffer and applies stream filtering locally. This matches current behavior and avoids needing separate subscriptions per stream filter.

#### `extensions/processes-logs/logs-client.ts`

Helper that encapsulates the subscribe/unsubscribe/chunk listening pattern.

```ts
interface LogsConnection {
  initialLines: Array<{ type: "stdout" | "stderr"; text: string }>;
  onChunk: (callback: (lines: Array<{ type: "stdout" | "stderr"; text: string }>) => void) => void;
  unsubscribe: () => void;
}

function connectToProcessLogs(
  events: EventBus,
  processId: string,
  opts?: { tailLines?: number }
): Promise<LogsConnection>
```

This is used by both the logs overlay and potentially the dock component. If the dock extension needs the same pattern, it can have its own copy or this can be extracted to a shared location later.

### Phase 4 Verification

1. `/ps:logs` opens the overlay with tabs.
2. Selecting a tab shows that process's logs.
3. New output streams in live.
4. Switching tabs properly unsubscribes/resubscribes.
5. Search works (/, n, N).
6. Stream filter works (s to cycle).
7. Follow mode works (f).
8. Closing the overlay unsubscribes.
9. No direct ProcessManager imports.

---

## Phase 5: Dock Extension (`extensions/processes-dock/`)

### Goal

Own the dock widget, status widget, and `/ps:dock`, `/ps:pin` commands.

### Files

#### `extensions/processes-dock/index.ts`

Entry point. Registers:
- `/ps:dock` command
- `/ps:pin` command
- Status widget (below editor)
- Log dock widget (above editor)

Subscribes to:
- `CHANNELS.STARTED`, `CHANNELS.ENDED`, `CHANNELS.CHANGED` -- for widget updates
- `CHANNELS.OUTPUT_CHANGED` -- for dock live updates
- `processes:dock:focus` -- emitted by list extension when user selects a process

Tracks disposers, cleans up on session_shutdown.

Needs to register on `session_start` to get `ctx` for widget management.

#### `extensions/processes-dock/commands/dock.ts`

The `/ps:dock` command handler. Controls dock visibility (show/hide/toggle).

Same as current implementation but operates on local dock state.

#### `extensions/processes-dock/commands/pin.ts`

The `/ps:pin` command handler. Pins the dock to a specific process.

Uses `CHANNELS.REQUEST_LIST` for completions and `CHANNELS.REQUEST_GET` to validate.

This command focuses the dock on a specific process. It does not affect any future cross-session persistence policy.

Current behavior: `/ps:pin` sets the dock focus to a process. Preserve this.

#### `extensions/processes-dock/components/log-dock-component.ts`

Rewrite of current `src/components/log-dock-component.ts`.

Changes:
- Uses log subscription protocol instead of direct manager access
- Uses `CHANNELS.REQUEST_LIST` for process list
- Uses `CHANNELS.REQUEST_COMBINED_OUTPUT` for collapsed view (last line preview)
- Subscribes to `CHANNELS.CHANGED` for process list updates

The dock has two modes:
- **Collapsed**: shows running process names + last log line. Uses `REQUEST_COMBINED_OUTPUT` with tailLines=1.
- **Open**: shows LogFileViewer-style live output for the focused process. Uses log subscription.

#### `extensions/processes-dock/widget/setup.ts`

Rewrite of current `src/hooks/widget/setup.ts`.

This is the widget orchestrator. It:
- Tracks `activeCtx` from `session_start`
- Manages dock state (visibility, follow, focusedProcessId)
- Renders the status widget (below editor) using `ctx.ui.setWidget()`
- Renders the dock widget (above editor) using `ctx.ui.setWidget()`
- Reacts to process lifecycle events to auto-show/hide dock

For process list data, emits `CHANNELS.REQUEST_LIST`. For config, emits `CHANNELS.REQUEST_CONFIG`.

#### `extensions/processes-dock/widget/status-widget.ts`

Rewrite of current `src/hooks/widget/status-widget.ts`.

The `renderStatusWidget()` function. Takes process list and theme, returns rendered lines.

Uses `CHANNELS.REQUEST_LIST` to get the process list.

#### `extensions/processes-dock/widget/types.ts`

Dock state types. Same as current:
- `DockVisibility = "hidden" | "collapsed" | "open"`
- `DockState { visibility, followEnabled, focusedProcessId }`
- `DockActions { getFocusedProcessId, isFollowEnabled, setFocus, expand, collapse, hide, toggle }`

#### `extensions/processes-dock/dock-state.ts`

The dock state machine. Manages DockState and DockActions. Extracted from current widget/setup.ts.

#### `extensions/processes-dock/logs-client.ts`

Same pattern as `extensions/processes-logs/logs-client.ts`. Encapsulates log subscription for the dock's open mode.

### Phase 5 Verification

1. Status widget shows below editor when enabled.
2. Dock shows above editor.
3. `/ps:dock show/hide/toggle` works.
4. `/ps:pin` focuses dock on a process.
5. Dock collapsed mode shows process names + last line.
6. Dock open mode streams live output.
7. Follow mode auto-shows dock when process starts (if enabled).
8. Auto-hide on all processes finished (if enabled).
9. Process selection from `/ps` (Enter) focuses the dock.
10. No direct ProcessManager imports.

---

## Phase 6: Cleanup and Final Integration

### Goal

Stabilize the package, run full regression, clean up dead code.

### Tasks

#### 1. Update `package.json`

```json
{
  "pi": {
    "extensions": [
      "./extensions/processes/index.ts",
      "./extensions/processes-list/index.ts",
      "./extensions/processes-logs/index.ts",
      "./extensions/processes-dock/index.ts"
    ]
  }
}

If `skills/pi-processes/` is intentionally restored later, add it back to `pi.skills`. Do not keep a `pi.skills` entry pointing at a missing directory.
```

Update `files` array:
```json
{
  "files": [
    "src",
    "extensions",
    "README.md",
    "CONTRIBUTING.md"
  ]
}
```

#### 2. Update tsconfig.json

Update `include` to cover both `src/` and `extensions/`:
```json
{
  "include": ["src/**/*", "extensions/**/*"]
}
```

#### 3. Delete any old Pi-aware `src/` files that moved to extensions

The initial rewrite already removed the old Pi-aware `src/` tree. At cleanup time, verify no stragglers were recreated:

Remove if present:
- `src/index.ts` (old entry point)
- `src/config.ts` (moved to `extensions/processes/config.ts`)
- `src/tools/` (moved to `extensions/processes/tools/`)
- `src/hooks/` (moved to `extensions/processes/hooks/`)
- `src/commands/` (moved to list/logs/dock extensions)
- `src/components/` (moved to respective extensions)
- `src/constants/` (replaced by `src/types.ts` / `src/protocol.ts`)

Keep the pi-agnostic `src/` library.

#### 4. Import audit

Verify:
- `src/` has zero imports from `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@aliou/pi-utils-settings`, `@aliou/pi-utils-ui`
- `extensions/processes-list/`, `extensions/processes-logs/`, `extensions/processes-dock/` have zero imports from `src/manager` or `src/get-manager`
- Only `extensions/processes/` imports `getManager`

#### 5. Update AGENTS.md

Update the structure section to reflect the new directory layout.

#### 6. Update skill file

If `skills/pi-processes/SKILL.md` is restored, update it after the final command/tool surface is restored. Do not recreate the skill file as part of this rewrite unless explicitly needed.

#### 7. Regression test matrix

**Process lifecycle:**
- Start a process -> appears in `/ps`, dock updates, status widget updates
- Process exits successfully -> notification appears, dock auto-hides (if configured), `/ps` shows exit(0)
- Process fails -> notification custom message appears with exit code and triggers an agent turn by default
- Stop a process -> `/ps:kill` or tool `stop` action, process shows as killed

**Session lifecycle:**
- Reload/new/fork -> the current extension-owned manager is shut down
- Pi exit -> all live processes are killed via `manager.killAll()`

**Log streaming:**
- `/ps:logs` shows live output
- Tab switching in logs overlay re-subscribes correctly
- Dock open mode shows live output
- Search in logs works
- Stream filter in logs works

**Settings:**
- `/ps:settings` opens and works
- Config changes take effect

**Tool:**
- All planned tool actions work: start, list, stop, output, logs, clear, write
- Tool rendering (call and result) works correctly
- Extension notification reactions work for lifecycle and log-match events

**Background blocker:**
- When enabled, `bash` tool calls with `&`, `nohup`, etc. are blocked

**Edge cases:**
- Multiple processes running simultaneously
- Rapid start/kill cycles
- No processes -> empty states in all UIs
- Very long output -> truncation works in tool output action

### Phase 6 Verification

1. `pnpm typecheck` passes
2. `pnpm lint` passes
3. `pnpm test` passes (manager tests + command-executor tests)
4. Full manual QA pass through all commands and tool actions
5. Reload cycle test (start processes, reload, verify expected behavior)

---

## Appendix A: Things That Change for Users

During the rewrite, the extension is intentionally restored in slices.

Current user-visible state after Phase 2A:
- The LLM-facing `process` tool exists.
- The tool supports `start`, `list`, and `stop`.
- `/ps`, `/ps:kill`, `/ps:clear`, `/ps:logs`, `/ps:dock`, `/ps:pin`, and `/ps:settings` are not restored yet.

Planned final user-visible behavior:
- Preserve the prior command/UI behavior where still useful.
- Prefer `stop` as the LLM-facing tool action name; keep `/ps:kill` as the explicit UI command name.
- Restore output/log access, clear, stdin write, extension-owned log-match notifications, lifecycle notifications, settings, list UI, logs UI, and dock UI.

Cross-session process persistence is deferred; see `docs/future-persistent-manager.md`.

## Appendix B: Manager Lifetime Policy

Cross-session persistence is not implemented in Phase 1. `ProcessManager` is a pure process lifecycle utility with no Pi session semantics.

`get-manager.ts` is a small factory. The core extension owns the returned manager in its closure and must shut it down on `session_shutdown`.

Session shutdown is instance-owned: dispose the current extension instance's listeners, unregister that manager from process-exit cleanup, then call `manager.killAll()` and `manager.cleanup()` on the same manager object.

Actual Node process exit is registry-owned: `hooks/exit.ts` keeps a global `Set<ProcessManager>` of currently live extension-owned managers and one guarded set of process exit handlers. The handlers iterate the current set and call `killAll()` on each manager.

The skill file and prompt guidelines do not need persistence-specific behavior.

## Appendix C: Key Implementation Gotchas

1. **Listener leaks**: Every `pi.events.on()` and `manager.onEvent()` returns an unsubscribe function. These MUST be stored and called on session_shutdown. The EventBus is never cleared by Pi.

2. **Stale Pi context**: After `/new`/`/fork`/`/resume`, the old `pi` proxy throws on any method call. Do not solve this by swallowing stale-proxy errors. Prevent stale calls through lifecycle ownership: notification services must be extension-instance scoped, expose `dispose()`, set a disposed flag before cleanup, unsubscribe manager/pi event listeners, and never send after disposal.

3. **Exit hook duplication**: The `process.once("exit", ...)` handler in `hooks/exit.ts` must be guarded by a globalThis flag. Without this, each extension reload would add another exit handler. The guarded handler must iterate a global manager set, not close over one manager from the first extension load.

4. **Manager construction options**: `getManager()` creates a new manager for the extension instance. The `getConfiguredShellPath` callback is a closure that reads from `configLoader.getConfig()`, so config changes are picked up automatically without needing to reconstruct the manager.

5. **Subscriber map lifecycle**: The subscriber map for log streaming lives in the core extension instance (not on globalThis). On reload, it is recreated empty. This is correct -- all UI extensions are also reloading and will re-subscribe if needed.

6. **Event bridge ordering**: The event bridge must be attached before request/command handlers so that any events triggered during handler setup are properly bridged. In practice this rarely matters, but maintaining the order is defensive.

7. **Log chunk content**: The `process_output_changed` manager event should include `appendedText` (the completed lines since last emit). Without this, the subscription handler would need to track per-subscriber file offsets and re-read from disk on every event, which is expensive and complex.
