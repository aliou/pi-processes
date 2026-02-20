---
"@aliou/pi-processes": minor
---

Add opt-in blocker for background bash commands: when enabled, `bash` tool calls that would spawn a background process (`&`) are held for approval before execution.

Fix process list column truncation on narrow terminals. Move `@mariozechner/pi-tui` to peer dependencies.
