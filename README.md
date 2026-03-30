# pi-processes

Manage background processes from Pi without blocking the conversation.

This extension lets Pi keep long-running commands alive while the conversation continues. It is useful for dev servers, test watchers, local APIs, builds, and log tails.

## Let Pi keep working while processes run

When a task needs a long-running command, Pi can start it in the background by itself and keep helping with the rest of the work.

That means Pi can, for example:

- start a dev server and keep coding
- keep a test watcher running while it fixes failures
- run a local API while it inspects logs
- watch build output without blocking the conversation

You can then inspect, pin, or stop those processes from the UI.

<!-- VIDEO: {"id":"agent-starts-processes","title":"Pi starts a long-running process and keeps working"} -->

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

Use `/ps` to open the main process panel.

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

<!-- VIDEO: {"id":"process-panel","title":"Browse and manage processes from the panel"} -->

## Inspect logs

Use `/ps:logs [id|name]` to open the log overlay for one process.

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

<!-- VIDEO: {"id":"inspect-logs","title":"Open the log overlay and inspect output"} -->

## Pin one process

Use `/ps:pin [id|name]` to keep the dock focused on one process.

This is useful when one process matters more than the others, such as a dev server or a test watcher.

Without arguments, Pi shows a picker.

<!-- VIDEO: {"id":"pin-process","title":"Pin the dock to one process"} -->

## Control the dock

Use `/ps:dock [show|hide|toggle]` to control dock visibility.

The dock gives you a compact live view without leaving the conversation.

<!-- VIDEO: {"id":"dock-control","title":"Show, hide, and use the dock"} -->

## Adjust settings

Use `/ps:settings` to configure the extension.

Available settings include:

- process list size
- output limits
- shell path override
- dock defaults
- follow mode behavior
- optional background command interception

<!-- VIDEO: {"id":"settings","title":"Adjust process extension settings"} -->

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

## Contributing

For development, testing, docs generation, and extension internals, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
