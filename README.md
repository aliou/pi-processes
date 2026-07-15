![banner](https://assets.aliou.me/pi-extensions/banners/pi-processes.png)

# pi-processes

Manage background processes from Pi without blocking the conversation.

This extension lets Pi keep long-running commands alive while the conversation continues. It is useful for dev servers, test watchers, local APIs, builds, and log tails.

## Let Pi keep working while processes run

When a task needs a long-running command, Pi can start it in the background by itself and keep helping with the rest of the work.

[![Pi starts a long-running process and keeps working](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/agent-starts-processes.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/agent-starts-processes.mp4)

That means Pi can, for example:

- start a dev server and keep coding
- keep a test watcher running while it fixes failures
- run a local API while it inspects logs
- watch build output without blocking the conversation

You can then inspect, pin, stop, or clear those processes from the UI.

## Installation

From npm:

```bash
pi install npm:@aliou/pi-processes
```

From git:

```bash
pi install git:github.com/aliou/pi-processes
```

## Open the process panel

Use `/ps` to open the main process panel. It shows running and finished processes, with the most recent output preview. The preview opens on the newest page so you can see live activity without scrolling.

[![Browse and manage processes from the panel](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/process-panel.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/process-panel.mp4)

From there you can:

- see running and finished processes
- inspect recent output
- pin a process to the dock
- kill a running process
- clear finished entries

Keys:

- `j/k` or arrow keys: move selection
- `J/K`: scroll preview
- `enter`: pin selected process to the dock
- `x`: kill selected process
- `c`: clear finished processes
- `q` or `esc`: close

## Inspect logs

Use `/ps:logs [id|name]` to open the log overlay for one process. The viewer is cached per process, so switching tabs preserves scroll position and follow mode.

[![Open the log overlay and inspect output](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/inspect-logs.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/inspect-logs.mp4)

This is useful when Pi started a server, watcher, or local API and you want to follow what it is doing in more detail.

Keys:

- `tab` / `shift+tab`: switch process tabs
- `g/G`: jump to top or bottom
- `j/k` or arrow keys: scroll
- `s`: switch between combined, stdout, and stderr
- `f`: toggle follow mode
- `/`: search
- `n/N`: move between search matches
- `q` or `esc`: close

## Pin one process

Use `/ps:pin [id|name]` to keep the dock focused on one process.

[![Pin the dock to one process](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/pin-process.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/pin-process.mp4)

This is useful when one process matters more than the others, such as a dev server or a test watcher.

Without arguments, Pi shows a picker.

## Control the dock

Use `/ps:dock [expand|collapse|close]` to control dock visibility.

[![Show, hide, and use the dock](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/dock-control.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/dock-control.mp4)

The dock gives you a compact live view without leaving the conversation.

## Stop and clear processes

Use `/ps:kill [id|name]` to stop a running process, and `/ps:clear` to remove finished entries from the panel and free their log storage.

[![Stop and clear processes](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/stop-and-clear.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/stop-and-clear.mp4)

`/ps:kill` waits for the process to actually exit (or time out), so the result it reports reflects what happened. Without arguments, Pi shows a picker.

`/ps:clear` never touches live processes.

## Keep a status line in view

Enable the status widget in `/ps:settings` to show a compact line of running processes below the editor. Each process shows a status dot, its name, and its state, with `+N more` overflow when the line does not fit.

[![Status widget below the editor](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/status-widget.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/status-widget.mp4)

It is disabled by default. The widget reflows on resize and clears itself when the process list is empty.

## Send input to a process

Use the `process` tool with `action: "write"` to send bytes to a running process's stdin. This is how you drive interactive servers, REPLs, and CLIs that expect input after they start.

[![Send input to a running process](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/send-input.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/send-input.mp4)

Pass `input` for the bytes to write, and set `end: true` to close stdin (for example to signal EOF to a waiting process).

## Adjust settings

Use `/ps:settings` to configure the extension.

[![Adjust process extension settings](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/settings.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/settings.mp4)

Available settings include:

- process list size
- output limits
- shell path override
- dock defaults
- follow mode behavior
- status widget toggle
- optional background command interception

## Platform support

- macOS: supported
- Linux: supported
- Windows: not supported

## Runtime log watch alerts

Use the `process` tool `start` action with `notify.logMatches` to trigger immediate alerts while the process is still running.

- default behavior: each watch fires once (`repeat: false`)
- set `repeat: true` to trigger on every match
- scope by stream (`stdout`, `stderr`, `both`) to reduce noise

Example: server ready marker (one-time default)

```json
{
  "action": "start",
  "name": "dev-server",
  "command": "pnpm dev",
  "cwd": "/path/to/project",
  "notify": {
    "logMatches": [
      { "pattern": "ready on http://localhost:3000" }
    ]
  }
}
```

Example: error marker from stderr

```json
{
  "action": "start",
  "name": "builder",
  "command": "pnpm build --watch",
  "notify": {
    "logMatches": [
      {
        "pattern": "TypeError|ReferenceError",
        "mode": "regex",
        "stream": "stderr"
      }
    ]
  }
}
```

Example: repeatable watch on stdout only

```json
{
  "action": "start",
  "name": "worker",
  "command": "pnpm worker",
  "notify": {
    "logMatches": [
      { "pattern": "job completed", "stream": "stdout", "repeat": true }
    ]
  }
}
```

Empty patterns (literal or regex) are rejected at start and update time. Invalid regex patterns fail fast with a clear error.

## Troubleshooting

### Pi started something and I want to see more output

Open `/ps` for a quick overview, or use `/ps:logs` for full logs.

### I want one process to stay visible

Use `/ps:pin` to focus the dock on that process.

### I want Pi to avoid shell background tricks

Enable background command interception in `/ps:settings`. When enabled, Pi avoids normal shell background patterns and uses the process workflow instead.

## Contributing

For development, testing, docs generation, and extension internals, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
