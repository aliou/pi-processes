---
"@aliou/pi-processes": minor
---

- Record background processes still running at shutdown in an `ad-process:stopped` session entry.
- On the next session start in the same branch, display an unconsumed stopped-process entry without waking the agent.
- Show the stopped-process count when collapsed and each process name and command when expanded.
