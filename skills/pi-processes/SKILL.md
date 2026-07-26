---
name: pi-processes
description: Manage long-running commands with the process tool. Use when a task needs a dev server, watcher, build, test watcher, local API, log tail, or other command to keep running while the conversation continues.
---

# pi-processes

Use the `process` tool for commands that should keep running while the agent continues working. Do not use shell background patterns such as `&`, `nohup`, `disown`, or `setsid` when `process` fits.

## The core loop: start, do not wait, get notified

A started process runs in the background and the manager brings you back when something happens. You do not need to sleep, poll, or hold your turn for a process to finish.

1. `process start` a long-running command, with `notify.logMatches` for the signals you care about.
2. End your turn or move on to other work. Do not call `process output` in a loop waiting for "ready".
3. The process notifies you when:
   - a `logMatches` pattern hits (readiness, error, progress),
   - the process exits successfully (`onSuccess`, default `context`),
   - the process fails or crashes (`onFailure`, default `turn`),
   - the process is killed, by you or externally (`onKilled`, default `context`).
4. When a watch is too noisy or wrong, fix it with `process update` — do not restart the process just to change watches.
5. `process stop` obsolete live processes and `process clear` finished entries when they are no longer useful.

The only reason to wait after `process start` is when the next step literally cannot proceed until the process is ready, and even then prefer a `logMatches` watch over polling.

## Actions

### `process start`

Starts a managed process.

Use it for dev servers, test watchers, build watchers, long-running log tails, local APIs, and other commands that should continue while the conversation moves on.

Good:

```json
{
  "action": "start",
  "name": "web-dev",
  "command": "pnpm dev",
  "cwd": "/path/to/project",
  "notify": {
    "onSuccess": "context",
    "onFailure": "turn",
    "logMatches": [
      { "pattern": "ready", "mode": "literal", "stream": "both" },
      { "pattern": "EADDRINUSE", "mode": "literal", "stream": "stderr", "on": "turn" }
    ]
  }
}
```

Optional `cwd` sets the working directory for the spawned command. Omit it to inherit the agent's current working directory.

Empty `logMatches` patterns (literal or regex) are rejected at start and update time. Use `mode: "regex"` only when literal matching is not enough, scope by `stream` to cut noise, and use `repeat: true` when a matcher should fire more than once.

Bad:

```bash
pnpm dev &
nohup pnpm dev >/tmp/dev.log 2>&1 &
```

### `process list`

Shows managed processes and log file paths.

Use it before `process start` when a duplicate process would be harmful or noisy. Do not repeat the visible process table back to the user unless you need to explain a decision.

Optional filters:

- `statuses`: `all`, `running`, `finished`, `failed`, `terminating`, `terminate_timeout`, `killed`
- `sortBy`: `startTime_desc`, `startTime_asc`, `name_asc`, `name_desc`, `status_asc`
- `limit`: maximum number of processes to return

Good:

```json
{ "action": "list", "statuses": ["running"] }
```

```json
{ "action": "list", "statuses": ["failed", "killed"], "sortBy": "startTime_desc", "limit": 10 }
```

Bad:

```text
Starting another dev server without checking whether one is already running.
```

### `process output`

Reads recent stdout/stderr from one process.

Use it for targeted checks, especially with `pattern` and `mode`. Do not use it as a polling loop. Do not use it for deep log inspection; use `read` on the stdout/stderr file paths instead.

Good:

```json
{
  "action": "output",
  "id": "proc_1",
  "stream": "stderr",
  "pattern": "EADDRINUSE",
  "mode": "literal"
}
```

Bad:

```text
Calling process output every few seconds waiting for "ready".
```

Use watches instead:

```json
{
  "action": "update",
  "id": "proc_1",
  "watches": {
    "mode": "append",
    "items": [{ "pattern": "ready", "mode": "literal" }]
  }
}
```

### `process update`

Renames a running process or changes its watches. Update only works while the process is running.

Use it instead of restarting a process just to add, remove, or replace watch patterns. You can change `name` and `watches` in the same call.

`watches.mode` controls how the `items` are applied:

- `append` — add the items to the existing watches.
- `replace` — replace all watches with the items.
- `remove` — remove specific watches. Identify each by `index`, or by `pattern` (index takes precedence when both are given).
- `clear` — remove all watches. `items` is ignored.

Good:

```json
{
  "action": "update",
  "id": "proc_1",
  "name": "api-dev",
  "watches": {
    "mode": "append",
    "items": [
      { "pattern": "Server listening", "mode": "literal" },
      { "pattern": "EADDRINUSE", "mode": "literal", "stream": "stderr" }
    ]
  }
}
```

Bad:

```text
Stopping and restarting a server only to add a readiness matcher.
```

### `process write`

Sends bytes to a running process's stdin.

Use it to drive interactive servers, REPLs, and CLIs that expect input after they start. Pass `input` for the bytes to write, and set `end: true` to close stdin (for example to signal EOF to a waiting process).

Good:

```json
{ "action": "write", "id": "proc_1", "input": "quit\n" }
```

```json
{ "action": "write", "id": "proc_1", "end": true }
```

Bad:

```text
Writing with no `input` and no `end` (a no-op). The tool rejects it.
```

### `process stop`

Stops a managed process.

Use it when a process is obsolete, blocking a port, or no longer needed. Intentional stops suppress normal failure noise.

Good:

```json
{ "action": "stop", "id": "proc_1" }
```

### `process clear`

Clears finished processes and their log storage.

Use it after stopped, failed, or completed processes are no longer useful. It never clears live processes.

Good:

```json
{ "action": "clear" }
```

## Notification reference

`notify` on `process start` (and watches on `process update`) control how the manager brings you back.

Exit attention:

- `notify.onSuccess` — when the process exits successfully. Defaults to `context`.
- `notify.onFailure` — when the process fails or crashes. Defaults to `turn`.
- `notify.onKilled` — when the process is killed, by you or externally. Defaults to `context`.

Log match watches (`notify.logMatches`, up to 20, each pattern up to 500 chars):

- `pattern` — required. Literal by default; regex when `mode: "regex"`. Empty patterns are rejected.
- `mode` — `literal` (default) or `regex`.
- `stream` — `stdout`, `stderr`, or `both` (default). Scope to cut noise.
- `repeat` — `false` (default) fires once; `true` fires on every match.
- `on` — `turn`, `context`, or `ignore`. Overrides the default attention for that watch. Defaults to `turn`.

`turn` interrupts with an agent message. `context` adds the notice as context without interrupting. `ignore` records the match silently.

## Use cases

### Dev server readiness

Start a server, get brought back when it prints its ready marker, then keep working.

```json
{
  "action": "start",
  "name": "web-dev",
  "command": "pnpm dev",
  "notify": {
    "logMatches": [{ "pattern": "ready", "stream": "stdout" }]
  }
}
```

You do not wait. End your turn; the watch fires and the manager brings you back.

### Test watcher failures

Keep a watcher running and react only when a test fails.

```json
{
  "action": "start",
  "name": "vitest-watch",
  "command": "pnpm test --watch",
  "notify": {
    "logMatches": [
      { "pattern": "FAIL", "stream": "stdout", "repeat": true, "on": "turn" },
      { "pattern": "Error:", "stream": "stderr", "repeat": true, "on": "turn" }
    ]
  }
}
```

### Build errors from stderr

Watch a build watcher and surface type or compile errors as they happen.

```json
{
  "action": "start",
  "name": "builder",
  "command": "pnpm build --watch",
  "notify": {
    "logMatches": [
      { "pattern": "TypeError|ReferenceError", "mode": "regex", "stream": "stderr", "repeat": true }
    ]
  }
}
```

### Repeatable progress markers

Fire on every job completion, not just the first.

```json
{
  "action": "start",
  "name": "worker",
  "command": "pnpm worker",
  "notify": {
    "logMatches": [{ "pattern": "job completed", "stream": "stdout", "repeat": true }]
  }
}
```

### Interactive process that needs stdin

Start a process that waits for input, drive it, then close stdin.

```json
{ "action": "start", "name": "customer-import", "command": "npm run import:customer" }
```

```json
{ "action": "write", "id": "proc_1", "input": "ALFKI\n", "end": true }
```

The process prints its result and exits; `onFailure`/`onSuccess` brings you back.

## When a log watch is too noisy

A watch that fires too often wastes turns. Fix it with `process update` — never restart the process just to change watches.

First, diagnose: is the pattern too broad, on the wrong stream, or repeating when it should fire once?

Then pick a `watches.mode`:

- **Tighten the pattern or scope the stream** — `replace` all watches with corrected ones.

```json
{
  "action": "update",
  "id": "proc_1",
  "watches": {
    "mode": "replace",
    "items": [{ "pattern": "EADDRINUSE", "stream": "stderr" }]
  }
}
```

- **Drop `repeat`** — if a `repeat: true` watch fires on every line, replace it with the same pattern and `repeat` omitted (defaults to `false`).

- **Remove one watch** — `remove` by `index` or `pattern`.

```json
{
  "action": "update",
  "id": "proc_1",
  "watches": {
    "mode": "remove",
    "items": [{ "pattern": "ready" }]
  }
}
```

```json
{
  "action": "update",
  "id": "proc_1",
  "watches": {
    "mode": "remove",
    "items": [{ "index": 0 }]
  }
}
```

- **Silence without removing** — set the watch's `on` to `ignore` so matches are recorded but do not interrupt.

```json
{
  "action": "update",
  "id": "proc_1",
  "watches": {
    "mode": "replace",
    "items": [{ "pattern": "job completed", "stream": "stdout", "repeat": true, "on": "ignore" }]
  }
}
```

- **Remove all watches** — `clear`.

```json
{
  "action": "update", "id": "proc_1", "watches": { "mode": "clear" } }
```

## Common mistakes

### Polling output instead of setting watches

Bad:

```text
Call process output repeatedly until the server is ready.
```

Good:

```json
{
  "action": "start",
  "name": "web-dev",
  "command": "pnpm dev",
  "notify": { "logMatches": [{ "pattern": "ready", "mode": "literal" }] }
}
```

### Waiting or sleeping after start

Bad:

```text
Start a dev server, then sleep or hold the turn until it is ready.
```

Good:

```text
Start the server with a "ready" watch and end the turn. The watch brings you back.
```

### Restarting instead of updating watches

Bad:

```text
Stop and restart a process because you forgot to watch for EADDRINUSE, or because a watch is too noisy.
```

Good:

```json
{
  "action": "update",
  "id": "proc_1",
  "watches": {
    "mode": "append",
    "items": [{ "pattern": "EADDRINUSE", "stream": "stderr" }]
  }
}
```

### Starting duplicates

Bad:

```text
Start `pnpm dev` without checking existing process state.
```

Good:

```json
{ "action": "list", "statuses": ["running"] }
```

Then start only if needed.

### Missing common failure watches

When starting servers, consider watches for readiness and common failure signals:

- `ready`
- `listening`
- `compiled`
- `EADDRINUSE`
- `Error:`
- `UnhandledPromiseRejection`

Keep watch patterns specific enough to avoid noisy false positives.

### Re-summarizing visible tool output

Bad:

```text
The process list shows proc_1 is running, proc_2 exited, and proc_3 failed...
```

Good:

```text
I'll reuse the existing `web-dev` process.
```

### Using vague names

Bad names:

- `server`
- `test`
- `watch`

Good names:

- `web-dev`
- `api-dev`
- `vitest-watch`
- `tail-app-logs`

### Leaving obsolete processes running

Stop live processes that are no longer useful, especially duplicate dev servers or commands occupying ports. Clear finished entries when they are no longer needed for debugging.

## UI commands

Users can inspect and control processes with:

- `/ps` for overview and control.
- `/ps:logs` for focused logs.
- `/ps:dock` and `/ps:pin` when the dock extension is loaded.
- `/ps:kill` to stop a running process.
- `/ps:clear` to remove finished entries.
- `/ps:settings` for package settings.

Do not ask the user to start long-running commands manually. If a process needs to run, use the `process` tool.
