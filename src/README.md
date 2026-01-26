# Processes Extension

Manage background processes from Pi. Start long-running commands (dev servers, build watchers, log tailers) without blocking the conversation.

## Demo

<video src="https://assets.aliou.me/pi-extensions/2026-01-26-processes-demo.mp4" controls playsinline muted></video>

## Installation

Install via npm:

```bash
pi install npm:@aliou/pi-processes
```

Or via the pi-extensions package:

```bash
pi install git:github.com/aliou/pi-extensions
```

Or selectively in your `settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/aliou/pi-extensions",
      "extensions": ["extensions/processes"]
    }
  ]
}
```

## Features

- **Tool**: `processes` with actions: `start`, `list`, `output`, `logs`, `kill`, `clear`
- **Command**: `/processes` - interactive panel to view and manage processes
- Auto-cleanup on session exit
- File-based logging (logs written to temp files, not memory)
- Friendly process names (auto-inferred or custom)

## Usage

### Tool (for agent)

```
processes start "pnpm dev" name="backend-dev"
processes start "pnpm build" name="build" notifyOnSuccess=true
processes start "pnpm test" notifyOnFailure=true
processes list
processes output id="backend"
processes logs id="proc_1"
processes kill id="backend"
processes clear
```

**Notification parameters** (for `start` action):
- `notifyOnSuccess` (default: false) - Get notified when process completes successfully. Use for builds/tests where you need confirmation.
- `notifyOnFailure` (default: true) - Get notified when process crashes/fails. Use to be alerted of unexpected failures.
- `notifyOnKill` (default: false) - Get notified if killed by external signal. Note: killing via tool never notifies.

**Important:** You don't need to poll or wait for processes. Notifications arrive automatically based on your preferences. Start processes and continue with other work - you'll be informed if something requires attention.

Note: User always sees notifications in UI. Notification preferences only control whether the agent is informed.

### Command (interactive)

Run `/processes` to open the panel:
- `j/k` - select process
- `J/K` - scroll logs
- `x` - kill selected process
- `c` - clear finished processes
- `q` - quit

## Test Scripts

Test scripts in `test/` directory:

```bash
./test/test-output.sh          # Continuous output (80 chars/sec)
./test/test-exit-success.sh 5  # Exits successfully after 5s
./test/test-exit-failure.sh 5  # Exits with code 1 after 5s
./test/test-exit-crash.sh 5    # Exits with code 137 after 5s
```

## Future Improvements

- [ ] **Expandable log view**: Allow toggling between collapsed (current fixed height) and expanded (full height) log view in the `/processes` panel.

- [ ] **Copy log file path**: Add keyboard shortcut to copy the stdout/stderr log file path to clipboard for easy access.

- [ ] **Open logs in editor**: Add keyboard shortcut to open log files directly in the configured editor (`$EDITOR` or VS Code).
