---
"@aliou/pi-processes": patch
---

Intentional process kills via /ps are now delivered as a context-level
notification instead of being fully suppressed. The agent is not woken,
but it receives the lifecycle message so it can keep its state accurate.
