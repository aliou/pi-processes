---
"@victor-software-house/pi-processes": patch
---

Fix false crash reports for processes that exit successfully. The liveness poll could race with the Node.js close event and discard the real exit code, reporting success=false for exit code 0.
