# Process notifications

This document describes how process lifecycle and log-watch events become
notifications that reach the agent, which user options control each path, and
which paths bypass user config. It covers the event flow only — UI rendering
(`/ps`, dock, logs overlay) is out of scope.

There are three layers:

1. **ProcessManager wake state** (`src/manager/process-wake.ts`, the
   `ProcessWakeController`) owns each process's notify config, log watches,
   one-shot fired state, and intentional-stop markers. It evaluates watches on
   `process_output_changed` and emits `process_watch_matched`; it clears a
   process's wake state after `process_ended`.
2. **NotificationService** (`extensions/processes/notifications/service.ts`)
   subscribes to the manager's `process_ended` and `process_watch_matched`
   events, classifies the end, resolves an attention level, and emits a
   language-neutral payload on `CHANNELS.NOTIFICATION`. It is a message
   shaper only; all wake state and watch evaluation live in the
   pi-agnostic manager.
3. **Delivery listener** (`extensions/processes/handlers/notifications.ts`)
   subscribes to `CHANNELS.NOTIFICATION`, applies log-match rate limiting, and
   converts each payload into a persisted Pi custom message via
   `sendProcessNotificationMessage`.

UI extensions (`processes-logs`, `processes-dock`) also observe
`CHANNELS.NOTIFICATION` for display concerns (e.g. log-match highlighting) but
do not affect delivery.

### Delivery timing

`turn` notifications use Pi's `steer` path while a run is active (or before
any host lifecycle event has been observed), reaching the run after its current
tool calls finish. On an idle host the notification is instead persisted with
`triggerTurn: false` and the host is woken with a bare `pi.sendUserMessage`,
because a steer wake on an idle host skips `before_agent_start`
([#121](https://github.com/aliou/pi-processes/issues/121)). Only one wake is
sent until the woken run starts; the wake re-arms once the host is idle again.

`context` and emitted `ignore` notifications are sent with `triggerTurn: false`
and no `deliverAs`: they never
wake or steer the agent, and they persist as displayed custom messages
immediately. While a turn is running, Pi holds them and appends once every tool
result of the turn is in (pi 0.84.4+, [#8537](https://github.com/earendil-works/pi/issues/8537)),
so they never split a tool call from its result — the failure mode that made
Anthropic requests 400 (pi 0.84.2–0.84.3). On older pi this option shape is
unsafe: ≤0.84.1 steers the active run, and 0.84.2–0.84.3 appends mid-run.
This package targets pi 1.0.0; if you must support older pi, send
`deliverAs: "nextTurn"` instead — it defers the message until the next user
prompt on every version.

### Session idle state in persisted messages

Every delivered notification records `sessionIdle` in the persisted
`ad-process:notification` message `details`: whether the session was idle at
send time. The delivery listener (`registerNotificationDelivery` in
`extensions/processes/handlers/notifications.ts`) stamps it on a shallow copy
of the payload at delivery time, from the same `sessionIdle` variable that
drives the idle-wake path above. The payload broadcast on
`CHANNELS.NOTIFICATION` is never mutated and never carries the field, so UI
extensions observing the channel are unaffected. This covers the suppressed
log-match summary too, so saved history can distinguish a completion that woke
an idle session from one steered into an active run.

### Wake conditions

`ProcessManager.getWakeConditions(processId)` (backed by
`ProcessWakeController` in `src/manager/process-wake.ts`) is the single source
of truth for what can still wake the agent on behalf of a process. It returns
`null` for unknown or ended processes:

- `exitAttention` — the effective attention per end state, from the
  per-process wake config resolved through `resolveWakeAttention` and
  `DEFAULT_WAKE_ATTENTION` (a process with no registered config gets the
  defaults).
- `watches` — the still-configured log watches with defaults resolved, plus
  each watch's `fired` flag from the controller's live
  `CompiledLogMatcher` state, the only place one-shot fired state exists.
  A `repeat: false` watch that already fired reports `fired: true`.

`ProcessManager.listWithWake()` attaches these conditions as a `wake` field
on every live process in the list. The `processes:request:list` handler
replies with it directly (see [events.md](events.md)); ended processes omit
the field.

## Per-process notify config

Registered with the manager (`registerWakeConfig`) by the `process start`
and `process update` tools (`normalizeNotifyConfig` in
`extensions/processes/tools/notify.ts`):

| Field        | Type                              | Default   |
| ------------ | --------------------------------- | --------- |
| `onSuccess`  | `"turn"` \| `"context"` \| `"ignore"` | `"turn"`  |
| `onFailure`  | `"turn"` \| `"context"` \| `"ignore"` | `"turn"`  |
| `onKilled`   | `"turn"` \| `"context"` \| `"ignore"` | `"context"` |
| `logMatches` | `LogMatcherConfig[]`              | `[]`      |

Each `LogMatcherConfig`:

| Field    | Type                              | Default   |
| -------- | --------------------------------- | --------- |
| `pattern` | `string` (≤500 chars, non-empty) | required  |
| `mode`   | `"literal"` \| `"regex"`          | `"literal"` |
| `stream` | `"stdout"` \| `"stderr"` \| `"both"` | `"both"`  |
| `repeat` | `boolean`                         | `false`   |
| `on`     | `"turn"` \| `"context"` \| `"ignore"` | `"turn"`  |

There are no global settings that affect notifications. The extension config
(`ProcessConfig` in `extensions/processes/config/types.ts`) only covers
execution, output retention, and UI — none of it changes attention or delivery.

## Attention levels

An attention level is resolved per event and mapped to Pi send options by
`attentionToSendOptions` (`extensions/processes/notification-sender.ts`):

| Attention | `triggerTurn` | `deliverAs` | Agent effect |
| --------- | ------------- | ----------- | ------------ |
| `turn` | `true` | `steer` | Steers an active run after its current tool calls. On an idle host: persisted with `triggerTurn: false`, host woken with a bare user message. |
| `context` | `false` | — | Persists and displays immediately; never wakes or steers the agent. Mid-run, Pi appends it after the turn's tool results. |
| `ignore` | `false` | — | Suppressed for successful exits and external kills; emitted log matches persist without waking the agent. Failures are promoted to `context`. |

Every delivered message has `display: true`. A context-level message is visible
in the UI as soon as Pi appends it (immediately when idle, at the turn's tool
boundary while running) and participates in model context from the next
provider request on — no user prompt required.

## Lifecycle notifications

`NotificationService.handleProcessEnded` runs on every `process_ended` event
(deferred one microtask so the start tool can register the wake config
first; the manager clears its wake state for the process in a later
microtask). It classifies the end, resolves attention from the manager's
per-process wake config or defaults, and either emits or suppresses.

### Classification

`classifyProcessEnd` (`extensions/processes/notifications/classify.ts`):

| `ProcessInfo.status` / `endReason`          | Kind      |
| ------------------------------------------- | --------- |
| `status === "killed"`                       | `killed`  |
| `success === true`                          | `success` |
| `endReason` ∈ `spawn_error`/`missing_pid`/`lost` | `crash` |
| `exitCode !== null && exitCode !== 0`       | `crash`   |
| otherwise                                   | `failure` |

`terminate_timeout` never reaches `process_ended`: `ProcessManager.kill` sets
`endTime` and transitions to `terminate_timeout` without emitting, and the
`close` handler bails on the `endTime` guard. The timeout is carried by the
tool result (`KillResult.reason: "timeout"`) instead.

### Attention resolution

`resolveWakeAttention` (in `src/wake.ts`) picks the config field for the
kind, falling back to `DEFAULT_WAKE_ATTENTION`:

| Kind      | Config field | Default   |
| --------- | ------------ | --------- |
| `success` | `onSuccess`  | `turn`    |
| `failure` | `onFailure`  | `turn`    |
| `crash`   | `onFailure`  | `turn`    |
| `killed`  | `onKilled`   | `context` |

### Forced display for crashes/failures

After resolving attention, the service forces a minimum of `context` for
`crash` and `failure`:

- If attention is `ignore` and the kind is `crash` or `failure`, attention is
  upgraded to `context` and the notification is emitted.
- If attention is `ignore` and the kind is `success` or `killed`, the
  notification is suppressed entirely (no emit).

This means `onFailure: "ignore"` cannot silence a failed process — failures
always notify, so it becomes a context message: persisted immediately,
without waking or steering the agent.
`onSuccess: "ignore"` and `onKilled: "ignore"` suppress their notifications.

### Intentional stops (config bypass)

A stop is *intentional* when it goes through `killIntentionally`
(`extensions/processes/handlers/kill-process.ts`), which calls
`manager.markIntentionalStop(id)` before `manager.kill`. Three entry points
use it:

- The `process stop` tool.
- The `/ps:kill` command.
- The `/ps` overview panel `x` key (via `requestKill` →
  `CHANNELS.COMMAND_KILL`).

When `handleProcessEnded` sees an intentional stop, it **bypasses the
per-process config entirely** and emits a single `context` notification with
the classified kind. The agent is not woken, but it learns the process ended.
User `onKilled`/`onSuccess`/`onFailure` settings are ignored on this path.

If the kill fails (`not_found`/`error`) or the process is already dead, the
intentional-stop marker is consumed back and the normal path runs.

### End-state callstacks

Each block shows the call chain and the notification it produces. "Emit" means
a `CHANNELS.NOTIFICATION` payload with the shown attention; the delivery
listener then sends it as a Pi message.

#### Normal success

```
child process exits 0
  ProcessRuntimeController.child.on("close")          src/manager/process-runtime-controller.ts
    transition(managed, "exited")
      emit process_ended
        NotificationService.handleEvent               extensions/processes/notifications/service.ts
          queueMicrotask → handleProcessEnded
            classifyProcessEnd → "success"
            resolveWakeAttention → config.onSuccess ?? "turn"
            emit kind=success attention=<onSuccess>
              delivery listener → sendProcessNotificationMessage(triggerTurn=<onSuccess>)
```

Default: a turn. `onSuccess: "context"` downgrades to a context message.
`onSuccess: "ignore"` suppresses.

#### Normal failure (non-zero exit)

```
child process exits non-zero
  ProcessRuntimeController child.on("close")
    transition(managed, "exited")
      emit process_ended
        handleProcessEnded
          classifyProcessEnd → "crash"          (exitCode !== 0)
          resolveWakeAttention → config.onFailure ?? "turn"
          forced display: onFailure==="ignore" → upgraded to "context"
          emit kind=crash attention=<resolved or "context">
            delivery listener → sendProcessNotificationMessage
```

Default: a turn. `onFailure: "ignore"` becomes a context message (never fully
silent).

#### Spawn error / missing pid / lost

```
spawn error (or liveness tick detects lost/missing_pid)
  handleSpawnError / livenessTick
    transition(managed, "exited")
      emit process_ended
        handleProcessEnded
          classifyProcessEnd → "crash"
          resolveWakeAttention → config.onFailure ?? "turn"
          forced display: ignore → "context"
          emit kind=crash attention=<resolved or "context">
```

Same as normal failure: defaults to turn, `ignore` forced to context.

#### External kill (signal from outside the manager)

```
external signal kills the process group
  child.on("close", code, signal)
    transition(managed, "killed")                signal branch
      emit process_ended
        handleProcessEnded
          isIntentionalStop? no (no marker)
          classifyProcessEnd → "killed"
          resolveWakeAttention → config.onKilled ?? "context"
          (no forced display for killed)
          attention==="ignore" → suppressed; else emit kind=killed
            delivery listener → sendProcessNotificationMessage(triggerTurn=<onKilled>)
```

Default: a context message (no turn). `onKilled: "turn` promotes to a turn.
`onKilled: "ignore"` suppresses.

#### Intentional stop (config bypass)

```
/ps panel "x" | /ps:kill | process stop tool
  requestKill / executeStop
    COMMAND_KILL handler                         extensions/processes/handlers/commands.ts
      killIntentionally                          extensions/processes/handlers/kill-process.ts
        manager.markIntentionalStop(id)
        manager.kill(id, opts)
          transition(managed, "killed"|"exited")
            emit process_ended
              handleProcessEnded
                isIntentionalStop? yes
                  BYPASS config — emit kind=<classified> attention="context"
                    delivery listener → sendProcessNotificationMessage(triggerTurn=false)
```

Always a context message. Config is ignored. The agent is not woken.

#### Kill timeout (terminate_timeout)

```
manager.kill SIGTERM grace period expires, process still alive
  ProcessRuntimeController.kill                     src/manager/process-runtime-controller.ts
    endReason = "kill_timeout"; endTime = Date.now()
    transition(managed, "terminate_timeout")       (no process_ended emit — not exited/killed)
      returns KillResult { ok: false, reason: "timeout" }
  child.on("close") later → bails on endTime guard, no second process_ended
```

No notification. The timeout is reported through the tool/command result only.

## Log-watch notifications

The manager evaluates watches: `ProcessWakeController.handleOutputChanged`
runs on every `process_output_changed` event routed through the manager. It
syncs the compiled matcher set for the process, evaluates matchers against
the appended text, and emits a `process_watch_matched` manager event with
the matches. The NotificationService then emits one `log_match` payload per
match with the matcher's `on` attention.

```
process emits output
  ProcessOutput append
    emit process_output_changed { id, appendedText }
      ProcessWakeController.handleOutputChanged        src/manager/process-wake.ts
        registry wake state for id → none? return
        syncMatcherState(id, watchState)
        evaluateLogMatchers(matchers, appendedText, now)   src/manager/log-matchers.ts
          per matcher: skip if !repeat && fired; cooldown if repeat+fired
          per line: stream filter, plainTextForLogLine, lineMatcher
        emit process_watch_matched { id, matches }
          NotificationService.handleWatchMatches
            emit kind=log_match attention=match.on
              delivery listener → rate-limit check → sendProcessNotificationMessage
```

Matcher behavior:

- `repeat: false` (default) fires once per process lifetime.
- `repeat: true` fires again after a 15s cooldown
  (`LOG_MATCH_COOLDOWN_MS`).
- Lines are normalized with `plainTextForLogLine`
  (`src/manager/log-matchers.ts`) before matching, so CR
  progress lines and escape bytes do not fire watches.
- Lines longer than 10 000 chars are skipped.

Log-match `on: "ignore"` intentionally retains the match as context rather
than suppressing it. The delivery listener treats it like `context`, so it does
not wake or steer the agent and persists immediately (mid-run, after the
current turn's tool results). Use either
value when a match is useful later but requires no immediate response.

### Log-match rate limiting

The delivery listener caps live `log_match` deliveries at 20 per 60s window
(`MAX_LOG_MATCH_NOTIFICATIONS_PER_WINDOW`, `NOTIFICATION_WINDOW_MS`). Overflows
are counted and flushed as a single summary at window end:

```
log_match payload arrives
  delivery listener
    window expired or new? flush prior suppressed summary (kind=log_match_suppressed, attention=context)
    sentInWindow >= 20? suppressed++; return
    sentInWindow++; sendProcessNotificationMessage
  (window timer) flushSuppressedSummary
    emit kind=log_match_suppressed summary "Suppressed N log-match notifications..."
```

The summary is always `context`.

## Summary matrix

| End state                | Kind     | Default attention | Config field | `ignore` effect        | Bypassed by intentional stop? |
| ------------------------ | -------- | ----------------- | ------------ | ---------------------- | ----------------------------- |
| exit 0                   | success  | turn              | `onSuccess`  | suppressed             | yes → context                 |
| exit non-zero            | crash    | turn              | `onFailure`  | forced to context      | yes → context                 |
| spawn_error/missing/lost | crash    | turn              | `onFailure`  | forced to context      | yes → context                 |
| external signal          | killed   | context           | `onKilled`   | suppressed             | yes → context                 |
| intentional stop         | (classified) | context       | —            | —                      | (this is the bypass)          |
| kill timeout             | —        | —                 | —            | —                      | no emit (tool result only)    |
| log match                | log_match | turn             | matcher `on` | delivered as context   | n/a                           |
| log-match overflow       | log_match_suppressed | context | —    | —                      | n/a                           |

## References

- `extensions/processes/notifications/service.ts` — manager-event
  subscription, attention resolution, intentional-stop bypass,
  log-match message shaping.
- `extensions/processes/notifications/classify.ts` — end classification.
- `src/manager/process-wake.ts` — the `ProcessWakeController`: per-process
  wake config, watch state, one-shot fired state, and intentional-stop
  markers, plus watch evaluation and `getWakeConditions`/`listWithWake`.
- `src/manager/log-matchers.ts` — watch compilation, evaluation, cooldown,
  and matcher caps.
- `src/wake.ts` — plain wake-domain types, `DEFAULT_WAKE_ATTENTION`, and
  `resolveWakeAttention`.
- `extensions/processes/handlers/kill-process.ts` — intentional stop marking.
- `extensions/processes/handlers/notifications.ts` — delivery listener,
  log-match rate limiting, and the idle-host wake.
- `extensions/processes/notification-sender.ts` — attention → Pi send options.
- `extensions/processes/tools/notify.ts` — config normalization and defaults.
- `src/manager/process-runtime-controller.ts` — `process_ended` emission,
  `terminate_timeout` non-emit, `close`/`error`/liveness paths.
