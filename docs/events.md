# Extension events

This document lists the events dispatched between the pi-processes extensions
and what each one does, in the style of pi's extensions doc. Event names are
the stable surface; implementation details live in the code. For how a subset
of these events becomes agent notifications, see
[notifications.md](notifications.md).

There are three layers:

1. **Internal manager bus.** The process manager emits four internal events
   (`process_started`, `process_ended`, `process_output_changed`,
   `processes_changed`) to its listeners. This bus is pi-agnostic; no
   extension code runs on it.
2. **Extension event bus** (`pi.events`). The core extension bridges the
   manager's internal events onto public channels so the UI extensions can
   observe process state without importing manager internals. UI extensions
   send requests and commands back the other way. Payloads cross the bus by
   reference (reply callbacks included), so this is an in-process protocol,
   not serializable IPC.
3. **Pi lifecycle events** (`pi.on`). Standard extension hooks each extension
   uses for setup and teardown.

## Table of Contents

- [Events at a Glance](#events-at-a-glance)
- [Core Broadcasts](#core-broadcasts)
- [Requests](#requests)
- [Commands](#commands)
- [Log Subscriptions](#log-subscriptions)
- [Notification Fanout](#notification-fanout)
- [Internal Manager Events](#internal-manager-events)
- [Pi Lifecycle Events](#pi-lifecycle-events)

## Events at a Glance

```
manager ──internal events──► core extension
  │                            │
  │                            ├─► processes:started ────────► UI extensions
  │                            ├─► processes:ended ──────────► UI extensions
  │                            ├─► processes:output_changed ► UI extensions
  │                            └─► processes:changed ────────► UI extensions
  │
  any extension (UI extensions use these; adopt is for any emitter)
  ├─► processes:request:* ─────► core replies synchronously
  │                               (list, get, output, combined_output,
  │                                log_files, file_size, config)
  ├─► processes:command:* ─────► core (or dock, for pin) replies synchronously
  │                               (start, kill, clear, pin, adopt)
  └─► processes:logs:subscribe ► core streams processes:logs:chunk back

notification service ──► processes:notification ──► delivery listener, UI extensions
```

## Core Broadcasts

Core emits, UI extensions listen.

#### processes:started

Fired when a process starts, whether spawned by the extension or adopted from
another extension. The payload is the new process's info. The dock uses it to
apply its default open state, track that a process was seen running for
auto-close, and refresh its widgets.

#### processes:ended

Fired when a process ends. The payload is the final process info, including
exit code, end reason, and signal. This is a raw lifecycle broadcast; the
classified, config-aware notification is the separate `processes:notification`
event below.

#### processes:output_changed

Fired when a process has new output. The payload carries the process id, the
lines appended since the last event, and how many lines were dropped by
retention limits, if any. The overview panel appends to its live view when
following a process; the dock updates preview lines for pinned widgets.

#### processes:changed

Fired whenever the set of processes changes: `reason` is `"started"`,
`"ended"`, or `"cleared"`. It is a coarse refresh signal — subscribers re-query
process state rather than reconstructing it from the event alone. Emitted
alongside every other broadcast, and with `reason: "cleared"` after
`/ps:clear` removes finished processes from the registry.

## Requests

UI emits, core replies synchronously.

#### processes:request:list

Request the full process list, returned in registry insertion order.

#### processes:request:get

Request one process by id; replies with its info or null.

#### processes:request:output

Request per-stream output (stdout lines, stderr lines, status) for a process,
optionally tail-limited; replies with the output or null for unknown ids.

#### processes:request:combined_output

Request interleaved stdout and stderr for a process, optionally tail-limited.

#### processes:request:log_files

Request the on-disk paths of a process's stdout, stderr, and combined log
files.

#### processes:request:file_size

Request the current stdout and stderr log file sizes in bytes.

#### processes:request:config

Request the protocol-safe view of the current extension config: shell path,
interception, process-list, output retention, follow behavior, and widget
settings. UI extensions use this instead of reading config files themselves.

## Commands

Imperative actions. Core handles all of them except `processes:command:pin`,
which the dock extension handles if loaded.

#### processes:command:start

Start a process by name, command, and optional working directory. Replies with
the new process info on success or an error string on failure.

#### processes:command:kill

Kill a process by id, with optional signal and timeout. This is the path
behind `/ps:kill` and the process stop tool. Treated as an intentional stop:
per-process notify config is bypassed (see
[notifications.md](notifications.md)).

#### processes:command:clear

Remove all finished processes from the registry; replies with the number
removed. This is the path behind `/ps:clear`, and it drives the
`processes:changed` broadcast with `reason: "cleared"`.

#### processes:command:pin

Pin or unpin a process in the dock (pass null to unpin). The dock extension
handles this if loaded; if not, no listener replies and requesters time out.

#### processes:command:adopt

Attach an already-running child process to the manager, transferring
ownership from another extension. The child must have been spawned in a
detached process group with piped stdio so group kill and liveness polling
work on it. The payload carries the live child handle by reference, plus any
output captured before handover, the command, working directory, and start
time. The manager re-parents the child, replays captured output into the log
files, wires its own stream and close listeners, and from then on manages it
like any spawned process. The bus and reply are synchronous: pi-processes
installs its output listeners before the emit returns, so emitters must stop
reading both streams beforehand. If the processes extension is not loaded, no
listener replies.

## Log Subscriptions

Push-based log tailing between the core extension and the logs extension.

#### processes:logs:subscribe

Subscribe to a process's log stream, with an optional initial tail. Replies
with the initial lines or an error; the core extension keeps streaming new
lines to the subscriber after the initial tail.

#### processes:logs:chunk

Core emits, the logs extension listens. Carries the next batch of output
lines for one subscriber, tagged with the subscriber and process ids.

#### processes:logs:unsubscribe

Stop streaming for a subscriber. No reply.

## Notification Fanout

#### processes:notification

Core emits; the core delivery listener, the logs extension, and the dock all
listen.

The notification service classifies process ends (success, failure, crash,
killed) and log matches, resolves an attention level (`turn`, `context`, or
`ignore`) from the per-process notify config, and emits a language-neutral
payload. The delivery listener applies log-match rate limiting and converts
the payload into a persisted Pi custom message sent to the agent. UI
extensions observe the same event only for display concerns, such as
log-match highlighting.

See [notifications.md](notifications.md) for classification rules, attention
mapping, delivery timing, and the intentional-stop config bypass.

## Internal Manager Events

Emitted on the process manager's own bus, before the event bridge re-broadcasts
them publicly. Listed for completeness; they are not part of the
cross-extension protocol.

- `process_started` — a process was registered and is running.
- `process_ended` — a process reached a final state (exited, killed, spawn
  error, or lost). Never emitted for a kill timeout, which is reported by the
  kill result instead.
- `process_output_changed` — new output accumulated, carrying appended lines
  and any dropped-line count. Also drives log subscriptions.
- `processes_changed` — the registry list changed (used by `/ps:clear`).

## Pi Lifecycle Events

Beyond the bus protocol, the extensions subscribe to standard Pi extension
hooks:

- `session_start` — the core extension checks for pending config-migration and
  import messages and notifies the user; the dock tears down any previous
  controller and re-creates its widgets for the new session.
- `tool_call` — the core extension's background blocker inspects bash tool
  calls to optionally reject backgrounded commands when interception is
  enabled in config.
- `session_shutdown` — the core extension kills managed processes and disposes
  listeners, notification state, and overlays; the logs extension disposes
  open overlays; the dock disposes its controller.
