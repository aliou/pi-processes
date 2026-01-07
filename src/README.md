# Processes Extension

Manage background processes from Pi. Start long-running commands (dev servers, build watchers, log tailers) without blocking the conversation.

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
processes list
processes output id="backend"
processes logs id="proc_1"
processes kill id="backend"
processes clear
```

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

- [ ] **Process exit notifications**: Notify agent/LLM when a process exits by injecting a message into context or emitting an event. Include exit code and reason (success, failure, signal).

- [ ] **Expandable log view**: Allow toggling between collapsed (current fixed height) and expanded (full height) log view in the `/processes` panel.

- [ ] **Copy log file path**: Add keyboard shortcut to copy the stdout/stderr log file path to clipboard for easy access.

- [ ] **Open logs in editor**: Add keyboard shortcut to open log files directly in the configured editor (`$EDITOR` or VS Code).
