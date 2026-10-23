---
"@aliou/pi-processes": minor
---

Recover process groups orphaned when pi is SIGKILLed. Each started process now persists a small identity record (pid + `/proc` starttime + boot id + owning host identity) under the user's cache directory, written outside the temporary log directory. On the next session start, groups whose owning pi session is verifiably dead are killed and reported via a startup notification; concurrent live sessions and reused PIDs are never touched. The graceful `session_shutdown` → `killAll()` path is unchanged, and records are removed when a process ends or the session shuts down cleanly. Recovery is Linux-only (procfs identity) and stays disabled elsewhere; daemonized commands and groups whose leader exited still escape — see the new `docs/orphan-recovery.md` for the full limitation list.
