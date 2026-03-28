# pi-processes

Manage background processes from Pi without blocking the conversation. This extension gives the agent a `process` tool for long-running commands and gives the user a small TUI for watching logs, pinning a process, and cleaning things up.

Use it for dev servers, watchers, local APIs, tailing logs, and any command that should keep running while the conversation continues.

## Demo

<video src="https://assets.aliou.me/pi-extensions/2026-01-26-processes-demo.mp4" controls playsinline muted></video>

## What you get

- A single `process` tool with actions: `start`, `list`, `output`, `logs`, `kill`, `clear`, `write`
- A `/ps` process panel for browsing and managing processes
- A `/ps:logs` overlay for deeper log inspection
- A `/ps:pin` command to keep the dock focused on one process
- A `/ps:dock` command to show, hide, or toggle the dock
- A `/ps:settings` command for runtime config
- File-backed logs stored in temp files, not in memory only
- Automatic cleanup when the Pi session ends
- Optional interception of `bash` background patterns like `&`, `nohup`, `disown`, and `setsid`

## Installation

From npm:

```bash
pi install npm:@aliou/pi-processes
```

From git:

```bash
pi install git:github.com/aliou/pi-processes
```

## Platform support

- macOS: supported
- Linux: supported
- Windows: not supported. The extension loads, then shows a warning in the UI and does nothing.

## Quick start

### For the agent

Start a background process:

```text
process({ action: "start", name: "web", command: "pnpm dev" })
```

See current processes:

```text
process({ action: "list" })
```

Read recent output:

```text
process({ action: "output", id: "web" })
```

Get log file paths, then read them with Pi's `read` tool:

```text
process({ action: "logs", id: "web" })
```

Send input to stdin:

```text
process({ action: "write", id: "web", input: "q\n" })
process({ action: "write", id: "job", input: "payload", end: true })
```

Stop a process:

```text
process({ action: "kill", id: "web" })
```

Clear finished processes:

```text
process({ action: "clear" })
```

### For the user

Open the process panel:

```text
/ps
```

Open the log overlay for one process:

```text
/ps:logs web
```

Pin the dock to one process:

```text
/ps:pin web
```

## Tool reference

The extension registers one tool: `process`.

### `start`

Start a command in the background.

Required params:
- `name`
- `command`

Optional params:
- `alertOnSuccess` default `false`
- `alertOnFailure` default `true`
- `alertOnKill` default `false`

Example:

```text
process({
  action: "start",
  name: "backend-dev",
  command: "pnpm dev",
  alertOnFailure: true
})
```

Notes:
- The command runs in the current tool-call working directory.
- The tool returns the process id, pid, and log file location.
- The agent does not need to poll. If alert flags match the exit result, Pi gives the agent a turn automatically.

### `list`

Return all managed processes, newest first.

Example:

```text
process({ action: "list" })
```

### `output`

Return recent stdout and stderr for one process.

Required params:
- `id` - accepts either an exact id like `proc_1` or a name/command substring match like `backend`

Notes:
- Output is tail-based.
- Limits come from config: `output.defaultTailLines` and `output.maxOutputLines`.
- Large output is truncated from the tail and points to full log files.

Example:

```text
process({ action: "output", id: "backend" })
```

### `logs`

Return the log file paths for one process.

Required params:
- `id`

Returned paths:
- `stdoutFile`
- `stderrFile`
- `combinedFile`

Typical flow:
1. Call `process({ action: "logs", id: "backend" })`
2. Use Pi's `read` tool on one of the returned files

### `kill`

Send `SIGTERM` to a running process group.

Required params:
- `id`

Notes:
- The tool does a graceful terminate first.
- If termination times out, the process moves to `terminate_timeout`.
- In the `/ps` panel, pressing `x` on a `terminate_timeout` process sends `SIGKILL`.
- Killing via the tool suppresses `alertOnKill` for that process.

### `clear`

Remove finished processes from the list and delete their temp log files.

Example:

```text
process({ action: "clear" })
```

### `write`

Write data to a running process's stdin.

Required params:
- `id`
- `input`

Optional params:
- `end` - close stdin after writing

Use this for programs that wait for input or read until EOF.

## Slash commands

### `/ps`

Open the main process panel.

What it shows:
- process id
- friendly name
- command
- status
- runtime
- combined log size
- output preview for the selected process

Keys:
- `j/k` or arrow keys: move selection
- `J/K`: scroll the selected process preview
- `enter`: pin selected process to the dock
- `x`: terminate selected process, or force kill if it is already in `terminate_timeout`
- `c`: clear finished processes
- `q` or `esc`: close

### `/ps:logs [id|name]`

Open the floating log overlay for one process. Without args, it opens a picker first.

Keys:
- `tab` / `shift+tab`: switch process tabs
- `g/G`: jump to top or bottom
- `j/k` or arrow keys: scroll
- `s`: cycle stream filter between combined, stdout, stderr
- `f`: toggle follow mode
- `/`: start search
- `n/N`: next or previous search match while search is active
- `q` or `esc`: close

### `/ps:pin [id|name]`

Pin the dock to one process. If the dock is hidden or collapsed, this opens it.

Without args, it opens a picker.

### `/ps:kill [id|name]`

Terminate a running process. Without args, it opens a picker.

### `/ps:clear`

Clear all finished processes.

### `/ps:dock [show|hide|toggle]`

Control dock visibility.

- `show`: open the dock
- `hide`: hide the dock
- `toggle`: toggle visibility
- no arg: same as `toggle`

### `/ps:settings`

Open the settings UI for this extension.

## UI model

### Dock

The dock has 3 visibility states:
- `hidden`
- `collapsed`
- `open`

Collapsed mode shows:
- a one-line summary of live processes
- the latest log line from the first live process, when available

Open mode shows:
- one focused process
- a live view backed by the combined log file

### Status widget

There is also an optional one-line status widget below the editor. It is off by default.

### Follow mode

When follow mode is enabled by default:
- starting a process auto-shows the dock using `widget.dockDefaultState`
- finishing the last live process can auto-hide the dock

## Configuration

Configure the extension with `/ps:settings` or by editing:

```text
~/.pi/agent/extensions/process.json
```

Available settings:

### Process List
- `processList.maxVisibleProcesses` default `8`
- `processList.maxPreviewLines` default `12`

### Output Limits
- `output.defaultTailLines` default `100`
- `output.maxOutputLines` default `200`

### Execution
- `execution.shellPath` default `auto`

### Interception
- `interception.blockBackgroundCommands` default `false`

When enabled, background `bash` patterns are blocked and the model is told to use the `process` tool instead.

### Widget
- `widget.showStatusWidget` default `false`
- `widget.dockDefaultState` default `collapsed`
- `widget.dockHeight` default `12`

### Follow Mode
- `follow.enabledByDefault` default `true`
- `follow.autoHideOnFinish` default `true`

## Agent guidance

This extension is meant for the agent to start background processes. Users can inspect and kill processes from the UI, but process startup should happen through the `process` tool, not through manual shell backgrounding.

If you also enable `interception.blockBackgroundCommands`, the extension will block patterns like:
- `cmd &`
- `nohup cmd`
- `disown`
- `setsid cmd`

## Log files

Each managed process gets 3 temp files:
- stdout log
- stderr log
- combined log

The combined log is tagged internally so the UI can preserve stream information while reading a single file.

Temp files are removed when:
- the process is cleared with `process.clear` or `/ps:clear`
- the Pi session ends and cleanup runs

## Test scripts

The repository includes test scripts in `test/`:

```bash
./test/test-output.sh
./test/test-exit-success.sh 5
./test/test-exit-failure.sh 5
./test/test-exit-crash.sh 5
```

What they do:
- `test-output.sh`: emits continuous output
- `test-exit-success.sh`: exits with code `0` after N seconds
- `test-exit-failure.sh`: exits with code `1` after N seconds
- `test-exit-crash.sh`: exits with code `137` after N seconds

## Deprecated commands

These older aliases still work, but they are deprecated:

- `/process:list` -> `/ps`
- `/process:stream` -> `/ps:pin`
- `/process:logs` -> `/ps:logs`
- `/process:kill` -> `/ps:kill`
- `/process:clear` -> `/ps:clear`

## Dev

```bash
pnpm install
pnpm typecheck
pnpm lint
```

## Related docs

- `EVENTS.md` - event flow and interaction model
- `CHANGELOG.md` - release history
