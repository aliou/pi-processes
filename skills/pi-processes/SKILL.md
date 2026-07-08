---
name: pi-processes
description: Manage long-running commands with the process tool. Use when a task needs a dev server, watcher, build, test watcher, local API, log tail, or other command to keep running while the conversation continues.
---

# pi-processes

Use the `process` tool for commands that should keep running while the agent continues working. Do not use shell background patterns such as `&`, `nohup`, `disown`, or `setsid` when `process` fits.

## Basic workflow

1. Run `process list` before starting anything that might already be running.
2. Start long-running commands with `process start` and a specific name.
3. Add `notify.logMatches` when you need readiness, error, or progress signals.
4. Continue other work after starting the process. Let process notifications bring you back.
5. Use `process output` only for targeted recent inspection.
6. Use `read` on the log file paths from `process list` or `process output` for deep log reads.
7. Use `process update` to rename a process or change watches.
8. Use `process stop` for obsolete live processes and `process clear` for finished entries.

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
  "notify": {
    "logMatches": [
      { "pattern": "ready", "mode": "literal", "stream": "both" },
      { "pattern": "EADDRINUSE", "mode": "literal", "stream": "stderr" }
    ]
  }
}
```

Bad:

```bash
pnpm dev &
nohup pnpm dev >/tmp/dev.log 2>&1 &
```

### `process list`

Shows managed processes and log file paths.

Use it before `process start` when a duplicate process would be harmful or noisy. Do not repeat the visible process table back to the user unless you need to explain a decision.

Good:

```json
{ "action": "list", "statuses": ["running"] }
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

Renames a running process or changes its watches.

Use it instead of restarting a process just to add, remove, or replace watch patterns.

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
  "notify": {
    "logMatches": [{ "pattern": "ready", "mode": "literal" }]
  }
}
```

### Restarting instead of updating watches

Bad:

```text
Stop and restart a process because you forgot to watch for EADDRINUSE.
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
I’ll reuse the existing `web-dev` process.
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

- `/ps` for overview/control.
- `/ps:logs` for focused logs.
- `/ps:dock` and `/ps:pin` when the dock extension is loaded.
- `/ps:settings` for package settings.

Do not ask the user to start long-running commands manually. If a process needs to run, use the `process` tool.
