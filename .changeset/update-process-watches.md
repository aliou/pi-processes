---
"@aliou/pi-processes": minor
---

Add agent-facing process metadata updates. The `process` tool can now update mutable metadata for existing processes, including name, alert flags, and log watches. Agents can list, append, replace, remove, or clear watches, and optionally replay a bounded tail of recent output for newly added watches so they can repair missed or noisy watches without polling output or restarting long-running work.
