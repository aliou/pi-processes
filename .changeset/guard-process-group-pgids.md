---
"@aliou/pi-processes": patch
---

Guard process-group helpers against non-positive pgids. `isProcessGroupAlive` now returns `false` and `killProcessGroup` now throws a `RangeError` when given a `0` or negative process-group ID, instead of probing or signaling the caller's own process group.
