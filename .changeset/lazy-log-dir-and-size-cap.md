---
"@aliou/pi-processes": minor
---

Create the per-session log directory lazily, so a session that never starts a process leaves no temp directory behind. Cap each log file at 64 MB via truncate-and-restart; when a file exceeds the cap it is reset to a marker line and writing continues, so old history is discarded to bound disk (and RAM on tmpfs) usage. Budget ~128-192 MB per process.
