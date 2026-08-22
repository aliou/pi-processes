---
"@aliou/pi-processes": patch
---

Fix the process dock not auto-closing after very short-lived processes.
`hasSeenRunningProcess` is now set synchronously in the `STARTED` event
handler (`handleStarted`) rather than only inside the throttled
`hardRefresh`. Previously, a process that exited within the 125ms
`scheduleRefresh` throttle window on a fresh session never set the flag,
so the auto-close condition in `hardRefresh` never fired and the dock
stayed open showing the finished process.
