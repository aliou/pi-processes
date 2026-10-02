---
"@aliou/pi-processes": patch
---

Inject the session `PI_*` variables (`PI_SESSION_ID`, `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL`, `PI_REASONING_LEVEL`) into processes started via the `process` tool's `start` action, mirroring the environment pi's bash tool exposes.
