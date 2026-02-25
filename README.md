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
- **Commands**: `/ps` (interactive panel), `/ps:focus` (focus on process), `/ps:logs` (focus + expand), `/ps:kill` (kill process), `/ps:clear` (clear finished), `/ps:dock` (toggle dock)
- **Log Dock**: Unified view for all process logs with color-coded prefixes
- **Follow Mode**: Automatically shows dock when processes start (enabled by default)
- **Focus Mode**: Filter to a single process's logs
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

#### `/ps` - Open full panel

View and manage all processes in an interactive panel:
- `j/k` - select process
- `J/K` - scroll logs
- `enter` - focus on selected process
- `x` - kill selected process
- `c` - clear finished processes
- `q` - quit

#### `/ps:focus [id|name]` - Focus on a process

Focus on a specific process to view its logs in the dock. Opens the dock automatically if hidden.

Without arguments, shows a picker to select a process.

#### `/ps:logs [id|name]` - Show log paths

Display the stdout and stderr log file paths for a process.

#### `/ps:kill [id|name]` - Kill a process

Kill a running process. Without arguments, shows a picker.

#### `/ps:clear` - Clear finished

Remove all finished processes from the list.

#### `/ps:dock [on|off|expanded]` - Toggle dock

Control dock visibility. Without arguments, toggles between hidden/open. With arguments:
- `on` - Show dock (open)
- `off` - Hide dock
- `expanded` - Show dock open (same as on)

### Log Dock

The log dock shows interleaved logs from all processes with color-coded prefixes:

```
[dev]   GET /api/users 200 45ms    (cyan)
[test]  Running auth.test.ts...    (yellow)
[dev]   POST /api/auth 200 12ms
[test]  ✓ login flow
...
```

**Dock Keyboard Shortcuts** (when dock is open):
- `h` - focus previous process
- `l` - focus next process
- `f` - toggle focus mode (filter to single process)
- `x` - kill focused process
- `q` - close/unfocus dock
- `Shift+F` - toggle follow mode
- `Ctrl+Shift+P` - toggle dock visibility (global)

**Dock States:**
- `collapsed` (1-2 lines): Summary + last log line
- `open` (8-12 lines): Full interleaved or focused logs

### Deprecated Commands (backward compatible)

The following commands are deprecated but still work with a warning:
- `/process:list` → Use `/ps` instead
- `/process:stream` → Use `/ps:focus` instead
- `/process:logs` → Use `/ps:logs` instead
- `/process:kill` → Use `/ps:kill` instead
- `/process:clear` → Use `/ps:clear` instead

## Settings

Configure via `/ps:settings` or `~/.pi/agent/extensions/processes.json`:

- **Widget**: Dock default state, dock height
- **Follow Mode**: Enable by default, auto-hide on finish
- **Process List**: Max visible processes, max preview lines
- **Output Limits**: Default tail lines, max output lines
- **Execution**: Shell path override
- **Interception**: Block background commands

## Test Scripts

Test scripts in `src/test/` directory:

```bash
./src/test/test-output.sh          # Continuous output (80 chars/sec)
./src/test/test-exit-success.sh 5  # Exits successfully after 5s
./src/test/test-exit-failure.sh 5  # Exits with code 1 after 5s
./src/test/test-exit-crash.sh 5    # Exits with code 137 after 5s
```

## Future Improvements

- [ ] **Configurable keybindings UI**: Allow editing keybindings in settings panel
- [ ] **Process filtering**: Filter by name/status in full panel
- [ ] **Log search**: Search within logs (Ctrl+F in dock)
- [ ] **Copy log path**: Keyboard shortcut to copy log file path
- [ ] **Open in editor**: Keyboard shortcut to open logs in $EDITOR
- [ ] **Sound notifications**: Play sound on process completion