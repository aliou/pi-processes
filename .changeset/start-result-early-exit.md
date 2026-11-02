---
"@aliou/pi-processes": patch
---

Surface processes that exit immediately at `process start` time. `ProcessManager.start` now waits up to a short grace window (150ms) for an immediate exit: a process that fails inside the window fails the tool call with its outcome (`exited immediately: exit code N` / `failed to spawn (...)` / `killed by SIG...`) instead of being reported as a plain successful start, a clean `exit 0` is reported in the start result, and healthy long-running starts still report running. Because the start result already carries the outcome, no lifecycle notification is emitted for an end reported at start time.
