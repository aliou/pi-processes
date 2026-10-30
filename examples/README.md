# Examples

Extension snippets you can copy to `~/.pi/agent/extensions/` and adapt. Each file is self-contained.

- `bash-background.ts`: overrides the bash tool so a running command can move to pi-processes with a shortcut, a timeout, or after an idle period. Requires a pi-processes version that provides the `processes:command:adopt` channel.
- `bash-to-process.ts`: intercepts bash calls that use `&`, `nohup`, `setsid`, or `disown`, and starts them as managed processes instead of blocking them outright.
- `bash-notify-background.ts`: overrides the bash tool so a command that hits its timeout is handed to pi-processes and keeps running in the background instead of being killed.
- `bash-sleep-poll-blocker.ts`: tracks the log paths of every process started through the process tool, and blocks bash calls that sleep before reading one of those logs (`sleep 60; tail ... proc_X-stdout.log`). The block carries the `terminate` hint so the agent ends its turn and waits for the exit notification instead of polling. Requires `@aliou/sh`.
- `process-status/`: publishes managed processes over the terminal's Program Status Protocol (OSC 7501), one child record per process. It listens to `processes:changed` and reads the list over `processes:request:list`, so it needs only the core extension. Copy the whole folder.
- `tail-free-starts.ts`: intercepts `process` start calls that wrap the command in `2>&1 | tail -N`, rewrites them to run bare, and appends the tail of the merged log (plus the log paths) to the start result and exit notification. Requires `@aliou/sh`.
