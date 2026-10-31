---
"@aliou/pi-processes": patch
---

Hold process notifications while a compaction is in progress and deliver them once it ends. A turn notification that fired mid-compaction could previously append to the session and start a run before the compaction entry landed. Notifications that arrive between `session_before_compact` and `session_compact` / `session_compact_failed` are now held and delivered in arrival order with their original attention, including when compaction fails or is cancelled; log-match rate limiting still applies at arrival time.
