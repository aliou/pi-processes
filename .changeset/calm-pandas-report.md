---
"@aliou/pi-processes": patch
---

Report renames through `processes:changed` with reason `"updated"` instead of `"cleared"`, while retaining `"cleared"` for explicit clears and automatic reaping.
