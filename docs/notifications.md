# Process notifications

This document describes how process lifecycle and log-watch events become
notifications that reach the agent, which user options control each path, and
which paths bypass user config. It covers the event flow only — UI rendering
(`/ps`, dock, logs overlay) is out of scope.

There are two layers:

1. **NotificationService** (`extensions/processes/notifications/service.ts`)
   listens to the `ProcessManager` event bus, classifies the end, resolves an
   attention level, and emits a language-neutral payload on
   `CHANNELS.NOTIFICATION`.
2. **Delivery listener** (`extensions/processes/handlers/notifications.ts`)
   subscribes to `CHANNELS.NOTIFICATION`, applies log-match rate limiting, and
   converts each payload into a persisted Pi custom message via
   `sendProcessNotificationMessage`.

UI extensions (`processes-logs`, `processes-dock`) also observe
`CHANNELS.NOTIFICATION` for display concerns (e.g. log-match highlighting) but
do not affect delivery.

## Per-process notify config

Registered by the `process start` and `process update` tools
(`normalizeNotifyConfig` in `extensions/processes/tools/notify.ts`):

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

| Attention | `triggerTurn` | `deliverAs` | Agent effect                                       |
| --------- | ------------- | ----------- | -------------------------------------------------- |
| `turn`    | `true`        | `steer`     | Wakes an idle agent; the message steers the turn.  |
| `context` | `false`       | `steer`     | Delivered as a steer but does not wake the agent; seen when context returns. |
| `ignore`  | `false`       | `steer`     | Not emitted for lifecycle events (filtered upstream). For log matches, delivered like `context`. |

Every delivered message has `display: true`, so it is visible in the
conversation regardless of attention. The only difference between `turn` and
`context` is whether the agent is woken.

## Lifecycle notifications

`NotificationService.handleProcessEnded` runs on every `process_ended` event
(deferred one microtask so the start tool can register the notify config
first). It classifies the end, resolves attention from the per-process config
or defaults, and either emits or suppresses.

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

`resolveAttention` picks the config field for the kind, falling back to
`DEFAULT_ATTENTION`:

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

This means `onFailure: "ignore"` cannot fully silence a failed process — it
becomes a context message. `onSuccess: "ignore"` and `onKilled: "ignore"` do
fully silence.

### Intentional stops (config bypass)

A stop is *intentional* when it goes through `killIntentionally`
(`extensions/processes/handlers/kill-process.ts`), which calls
`registry.markIntentionalStop(id)` before `manager.kill`. Three entry points
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
            resolveAttention → config.onSuccess ?? "turn"
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
          resolveAttention → config.onFailure ?? "turn"
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
          resolveAttention → config.onFailure ?? "turn"
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
          resolveAttention → config.onKilled ?? "context"
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
        registry.markIntentionalStop(id)
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

`NotificationService.handleOutputChanged` runs on every
`process_output_changed` event. It syncs the compiled matcher set for the
process, evaluates matchers against the appended text, and emits one
`log_match` payload per match with the matcher's `on` attention.

```
process emits output
  ProcessOutput append
    emit process_output_changed { id, appendedText }
      NotificationService.handleOutputChanged
        registry.getWatchState(id) → null? return
        syncMatcherState(id, watchState)
        evaluateLogMatchers(matchers, appendedText, now)
          per matcher: skip if !repeat && fired; cooldown if repeat+fired
          per line: stream filter, plainTextForDisplay, lineMatcher
        for each match:
          emit kind=log_match attention=match.on
            delivery listener → rate-limit check → sendProcessNotificationMessage
```

Matcher behavior:

- `repeat: false` (default) fires once per process lifetime.
- `repeat: true` fires again after a 15s cooldown
  (`LOG_MATCH_COOLDOWN_MS`).
- Lines are normalized with `plainTextForDisplay` before matching, so CR
  progress lines and escape bytes do not fire watches.
- Lines longer than 10 000 chars are skipped.

Unlike lifecycle events, log-match `on: "ignore"` is **not** filtered by the
service: it emits on the channel and the delivery listener delivers it like
`context` (displayed steer, no turn). `on: "context"` and `on: "ignore"` are
effectively equivalent for log matches today.

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

- `extensions/processes/notifications/service.ts` — event handling, attention
  resolution, intentional-stop bypass, log-match emission.
- `extensions/processes/notifications/classify.ts` — end classification.
- `extensions/processes/notifications/registry.ts` — per-process config and
  intentional-stop markers.
- `extensions/processes/handlers/kill-process.ts` — intentional stop marking.
- `extensions/processes/handlers/notifications.ts` — delivery listener and
  rate limiting.
- `extensions/processes/notification-sender.ts` — attention → Pi send options.
- `extensions/processes/tools/notify.ts` — config normalization and defaults.
- `src/manager/process-runtime-controller.ts` — `process_ended` emission,
  `terminate_timeout` non-emit, `close`/`error`/liveness paths.
