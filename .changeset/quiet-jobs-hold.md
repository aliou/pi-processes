---
"@aliou/pi-processes": minor
---

Add an opt-in `holdSession` flag to `process start`. A held process emits `processes:hold_started` after start and `processes:hold_ended` exactly once when it ends, times out on kill, leaves the registry, or the session shuts down, so host status extensions can keep the session marked as working until a build or test finishes. Kill timeouts now also emit `processes_changed`.
