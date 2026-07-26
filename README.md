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

## How Pi stays in the loop

Pi does not wait around for a background process. After it starts one, it keeps helping with the rest of the work and gets brought back automatically when something happens:

- a readiness marker appears in the logs (a server prints "ready")
- an error appears in the logs (a build prints a type error)
- the process exits, whether it succeeded, failed, or was killed

That is how Pi can start a dev server and then keep coding, or run a test watcher and react when a test fails, without sleeping or polling. If a watch fires too often, Pi can quiet it without restarting the process.

## Open the process panel

Use `/ps` to open the main process panel. It shows running and finished processes, with the most recent output preview. The preview opens on the newest page so you can see live activity without scrolling.

From there you can:

- see running and finished processes
- inspect recent output
- pin a process to the dock
- kill a running process
- clear finished entries

## Inspect logs

Use `/ps:logs [id|name]` to open the log overlay for one process. The viewer is cached per process, so switching tabs preserves scroll position and follow mode.

This is useful when Pi started a server, watcher, or local API and you want to follow what it is doing in more detail.

## Control the dock

Use `/ps:dock [expand|collapse|close]` to control dock visibility.

The dock gives you a compact live view without leaving the conversation.

## Pin one process

Use `/ps:pin [id|name]` to keep the dock focused on one process.

This is useful when one process matters more than the others, such as a dev server or a test watcher.

Without arguments, Pi shows a picker.

## Stop and clear processes

Use `/ps:kill [id|name]` to stop a running process, and `/ps:clear` to remove finished entries from the panel and free their log storage.

`/ps:kill` waits for the process to actually exit (or time out), so the result it reports reflects what happened. Without arguments, Pi shows a picker.

`/ps:clear` never touches live processes.

## Keep a status line in view

Enable the status widget in `/ps:settings` to show a compact line of running processes below the editor. Each process shows a status dot, its name, and its state, with `+N more` overflow when the line does not fit.

It is disabled by default. The widget reflows on resize and clears itself when the process list is empty.

## Send input to a process

Use the `process` tool with `action: "write"` to send bytes to a running process's stdin. This is how you drive interactive servers, REPLs, and CLIs that expect input after they start.

Pass `input` for the bytes to write, and set `end: true` to close stdin (for example to signal EOF to a waiting process).

## Adjust settings

Use `/ps:settings` to configure the extension.

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

## Troubleshooting

### Pi started something and I want to see more output

Open `/ps` for a quick overview, or use `/ps:logs` for full logs.

### I want one process to stay visible

Use `/ps:pin` to focus the dock on that process.

### I want Pi to avoid shell background tricks

Enable background command interception in `/ps:settings`. When enabled, Pi avoids normal shell background patterns and uses the process workflow instead.

## Feature demos

**Browse and manage processes from the panel**

[![Browse and manage processes from the panel](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/process-panel.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/process-panel.mp4)

**Open the log overlay and inspect output**

[![Open the log overlay and inspect output](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/inspect-logs.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/inspect-logs.mp4)

**Show, hide, and use the dock**

[![Show, hide, and use the dock](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/dock-control.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/dock-control.mp4)

**Pin the dock to one process**

[![Pin the dock to one process](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/pin-process.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/pin-process.mp4)

**Stop and clear processes**

[![Stop and clear processes](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/stop-and-clear.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/stop-and-clear.mp4)

**Status widget below the editor**

[![Status widget below the editor](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/status-widget.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/status-widget.mp4)

**Send input to a running process**

[![Send input to a running process](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/send-input.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/send-input.mp4)

**Adjust process extension settings**

[![Adjust process extension settings](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/settings.gif)](https://assets.aliou.me/pi-extensions/demos/processes/v0.10.0/settings.mp4)

## Contributing

For development, testing, docs generation, and extension internals, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
