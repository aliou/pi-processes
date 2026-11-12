---
"@aliou/pi-processes": minor
---

Notify on stopped background processes at session start: when `session_shutdown` finds live processes, it records them in a `ad-process:stopped` session entry; on the next `session_start` in the same session tree, an unconsumed entry injects a displayed custom message that does not wake the agent. Collapsed it shows the stopped-process count; expanded it lists each process with its name and command.
