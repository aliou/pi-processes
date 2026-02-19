# Processes Extension

Manage background processes from Pi. Start long-running commands (dev servers, build watchers, log tailers) without blocking the conversation.

## Demo

<video src="https://assets.aliou.me/pi-extensions/2026-01-26-processes-demo.mp4" controls playsinline muted></video>

## Installation

```bash
pi install npm:@aliou/pi-processes
```

Or from git:

```bash
pi install git:github.com/aliou/pi-processes
```

## Features

- **Tool**: `process` with actions: `start`, `list`, `output`, `logs`, `kill`, `clear`
- **Commands**: `/process:list` (interactive panel), `/process:stream` (stream logs), `/process:logs` (log paths), `/process:kill` (kill process), `/process:clear` (clear finished)
- Auto-cleanup on session exit
- File-based logging (logs written to temp files, not memory)
- Friendly process names (auto-inferred or custom)

## Usage

### Tool (for agent)

```
process start "pnpm dev" name="backend-dev"
process start "pnpm build" name="build" alertOnSuccess=true
process start "pnpm test" alertOnFailure=true
process list
process output id="backend"
process logs id="proc_1"
process kill id="backend"
process clear
```

**Alert parameters** (for `start` action):
- `alertOnSuccess` (default: false) - Get a turn to react when process completes successfully. Use for builds/tests where you need confirmation.
- `alertOnFailure` (default: true) - Get a turn to react when process fails/crashes. Use to be alerted of unexpected failures.
- `alertOnKill` (default: false) - Get a turn to react if killed by external signal. Note: killing via tool never triggers a turn.

**Important:** You don't need to poll or wait for processes. Notifications arrive automatically based on your preferences. Start processes and continue with other work - you'll be informed if something requires attention.

Note: User always sees process updates in the UI. The alert flags control whether the agent gets a turn to react (e.g. check results, fix code, restart).

### Commands (interactive)

Run `/process:list` to open the panel:
- `j/k` - select process
- `J/K` - scroll logs
- `enter` - stream logs for selected process
- `x` - kill selected process
- `c` - clear finished processes
- `q` - quit

Other commands:
- `/process:stream [id|name]` - stream logs from a running process
- `/process:logs [id|name]` - show log file paths
- `/process:kill [id|name]` - kill a running process
- `/process:clear` - clear finished processes

## Test Scripts

Test scripts in `src/test/` directory:

```bash
./src/test/test-output.sh          # Continuous output (80 chars/sec)
./src/test/test-exit-success.sh 5  # Exits successfully after 5s
./src/test/test-exit-failure.sh 5  # Exits with code 1 after 5s
./src/test/test-exit-crash.sh 5    # Exits with code 137 after 5s
```

## Future Improvements

- [ ] **Expandable log view**: Allow toggling between collapsed (current fixed height) and expanded (full height) log view in the `/process:list` panel.

- [ ] **Copy log file path**: Add keyboard shortcut to copy the stdout/stderr log file path to clipboard for easy access.

- [ ] **Open logs in editor**: Add keyboard shortcut to open log files directly in the configured editor (`$EDITOR` or VS Code).
